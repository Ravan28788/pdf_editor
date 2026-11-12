import {
  PDFDocument,
  PDFName,
  StandardFonts,
  degrees,
} from '@cantoo/pdf-lib';
import type { FontFamilyChoice } from '../types/pdf';
import { dataUrlToBytes, parsePageRanges, stripExtension } from './fileBridge';
import {
  getVisualDimensions,
  hexToPdfRgb,
  isWinAnsiSafe,
  normalizeAngle,
  normalizeCommonPunctuation,
  visualPointToPdf,
} from './pdfCoords';
import {
  PdfPasswordRequiredError,
  getPdfMetadataSummary,
  loadPdfJsDocument,
} from './pdfRenderer';

export async function loadPdfLibDocument(
  bytes: Uint8Array,
  password?: string,
): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, {
      password: password || undefined,
    });
  } catch (err: unknown) {
    const msg = String((err as Error)?.message || err || '').toLowerCase();
    if (msg.includes('password') || msg.includes('encrypted') || msg.includes('decrypt')) {
      throw new PdfPasswordRequiredError(password ? 'incorrect_password' : 'need_password');
    }
    throw err;
  }
}

async function resolveFont(
  doc: PDFDocument,
  family: FontFamilyChoice,
  bold = false,
  italic = false,
) {
  if (family === 'Times') {
    if (bold && italic) return doc.embedFont(StandardFonts.TimesRomanBoldItalic);
    if (bold) return doc.embedFont(StandardFonts.TimesRomanBold);
    if (italic) return doc.embedFont(StandardFonts.TimesRomanItalic);
    return doc.embedFont(StandardFonts.TimesRoman);
  }
  if (family === 'Courier') {
    if (bold && italic) return doc.embedFont(StandardFonts.CourierBoldOblique);
    if (bold) return doc.embedFont(StandardFonts.CourierBold);
    if (italic) return doc.embedFont(StandardFonts.CourierOblique);
    return doc.embedFont(StandardFonts.Courier);
  }
  if (bold && italic) return doc.embedFont(StandardFonts.HelveticaBoldOblique);
  if (bold) return doc.embedFont(StandardFonts.HelveticaBold);
  if (italic) return doc.embedFont(StandardFonts.HelveticaOblique);
  return doc.embedFont(StandardFonts.Helvetica);
}

// 1. MERGE PDFs (supports full files or visual page selections)
export async function mergePdfs(
  sources: Array<{
    bytes: Uint8Array;
    password?: string;
    pageIndices?: number[];
    rotations?: Record<number, number>;
  }>,
  options?: {
    pageItems?: Array<{ sourceIndex: number; pageIndex: number; rotation: number }>;
  },
): Promise<Uint8Array> {
  const loadedDocs = await Promise.all(
    sources.map((s) => loadPdfLibDocument(s.bytes, s.password)),
  );
  const outDoc = await PDFDocument.create();

  if (options?.pageItems && options.pageItems.length > 0) {
    for (const item of options.pageItems) {
      const src = loadedDocs[item.sourceIndex];
      const [copied] = await outDoc.copyPages(src, [item.pageIndex]);
      const added = outDoc.addPage(copied);
      if (item.rotation) {
        const cur = added.getRotation().angle || 0;
        added.setRotation(degrees(normalizeAngle(cur + item.rotation)));
      }
    }
  } else {
    for (let i = 0; i < sources.length; i += 1) {
      const src = loadedDocs[i];
      const total = src.getPageCount();
      const indices =
        sources[i].pageIndices && sources[i].pageIndices!.length > 0
          ? sources[i].pageIndices!
          : Array.from({ length: total }, (_, idx) => idx);
      const copiedPages = await outDoc.copyPages(src, indices);
      copiedPages.forEach((copied, pos) => {
        const added = outDoc.addPage(copied);
        const rot = sources[i].rotations?.[indices[pos]] || 0;
        if (rot) {
          added.setRotation(degrees(normalizeAngle((added.getRotation().angle || 0) + rot)));
        }
      });
    }
  }

  return outDoc.save({ useObjectStreams: true });
}

// 2. SPLIT PDF
export type SplitMode = 'everyN' | 'ranges' | 'cutPoints' | 'bookmarks';

export async function splitPdf(options: {
  bytes: Uint8Array;
  fileName: string;
  password?: string;
  mode: SplitMode;
  everyN?: number;
  rangesText?: string;
  cutAfterPages?: number[]; // 1-based page numbers after which a split occurs
}): Promise<Array<{ fileName: string; data: Uint8Array; pageRangeLabel: string }>> {
  const { bytes, fileName, password, mode } = options;
  const baseName = stripExtension(fileName);
  const srcDoc = await loadPdfLibDocument(bytes, password);
  const totalPages = srcDoc.getPageCount();
  const groups: Array<{ indices: number[]; label: string }> = [];

  if (mode === 'everyN') {
    const step = Math.max(1, options.everyN || 1);
    for (let start = 0; start < totalPages; start += step) {
      const end = Math.min(totalPages, start + step);
      const indices = Array.from({ length: end - start }, (_, i) => start + i);
      groups.push({ indices, label: start + 1 === end ? `p${start + 1}` : `p${start + 1}-${end}` });
    }
  } else if (mode === 'ranges') {
    const rawParts = (options.rangesText || `1-${totalPages}`)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of rawParts) {
      const indices = parsePageRanges(part, totalPages);
      if (indices.length > 0) {
        groups.push({ indices, label: part.replace(/[^0-9a-zA-Z-]+/g, '_') });
      }
    }
  } else if (mode === 'cutPoints') {
    const cuts = Array.from(
      new Set(
        (options.cutAfterPages || [])
          .filter((p) => p >= 1 && p < totalPages)
          .sort((a, b) => a - b),
      ),
    );
    let prev = 0;
    for (const cut of cuts) {
      const indices = Array.from({ length: cut - prev }, (_, i) => prev + i);
      groups.push({ indices, label: prev + 1 === cut ? `p${cut}` : `p${prev + 1}-${cut}` });
      prev = cut;
    }
    if (prev < totalPages) {
      const indices = Array.from({ length: totalPages - prev }, (_, i) => prev + i);
      groups.push({
        indices,
        label: prev + 1 === totalPages ? `p${totalPages}` : `p${prev + 1}-${totalPages}`,
      });
    }
  } else if (mode === 'bookmarks') {
    const summary = await getPdfMetadataSummary(bytes, password);
    const starts = Array.from(
      new Set(
        summary.outline
          .map((o) => o.pageNumber)
          .filter((p) => p >= 1 && p <= totalPages),
      ),
    ).sort((a, b) => a - b);

    if (starts.length === 0) {
      groups.push({
        indices: Array.from({ length: totalPages }, (_, i) => i),
        label: `p1-${totalPages}`,
      });
    } else {
      if (starts[0] > 1) {
        const indices = Array.from({ length: starts[0] - 1 }, (_, i) => i);
        groups.push({ indices, label: `p1-${starts[0] - 1}` });
      }
      for (let i = 0; i < starts.length; i += 1) {
        const s = starts[i];
        const e = i + 1 < starts.length ? starts[i + 1] - 1 : totalPages;
        if (s <= e) {
          const indices = Array.from({ length: e - s + 1 }, (_, k) => s - 1 + k);
          groups.push({ indices, label: s === e ? `p${s}` : `p${s}-${e}` });
        }
      }
    }
  }

  const outputs: Array<{ fileName: string; data: Uint8Array; pageRangeLabel: string }> = [];
  for (let i = 0; i < groups.length; i += 1) {
    const grp = groups[i];
    const partDoc = await PDFDocument.create();
    const copied = await partDoc.copyPages(srcDoc, grp.indices);
    copied.forEach((p) => partDoc.addPage(p));
    const data = await partDoc.save({ useObjectStreams: true });
    outputs.push({
      fileName: `${baseName}_part${i + 1}_${grp.label}.pdf`,
      data,
      pageRangeLabel: grp.label,
    });
  }
  return outputs;
}

// 3. COMPRESS PDF
export type CompressionPreset = 'lossless' | 'low' | 'medium' | 'high';

export async function compressPdf(options: {
  bytes: Uint8Array;
  password?: string;
  preset: CompressionPreset;
  grayscale?: boolean;
  onProgress?: (current: number, total: number) => void;
}): Promise<Uint8Array> {
  const { bytes, password, preset, grayscale = false, onProgress } = options;

  if (preset === 'lossless' && !grayscale) {
    const srcDoc = await loadPdfLibDocument(bytes, password);
    const outDoc = await PDFDocument.create();
    const indices = Array.from({ length: srcDoc.getPageCount() }, (_, i) => i);
    const copied = await outDoc.copyPages(srcDoc, indices);
    copied.forEach((p) => outDoc.addPage(p));
    onProgress?.(indices.length, indices.length);
    return outDoc.save({ useObjectStreams: true });
  }

  const presetConfig: Record<Exclude<CompressionPreset, 'lossless'>, { dpi: number; quality: number }> = {
    low: { dpi: 180, quality: 0.86 },
    medium: { dpi: 130, quality: 0.7 },
    high: { dpi: 92, quality: 0.5 },
  };

  const cfg = preset === 'lossless' ? { dpi: 150, quality: 0.82 } : presetConfig[preset];
  const scale = cfg.dpi / 72;

  const pdfJsDoc = await loadPdfJsDocument(bytes, password);
  const outDoc = await PDFDocument.create();
  const total = pdfJsDoc.numPages;

  for (let p = 1; p <= total; p += 1) {
    const page = await pdfJsDoc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const vpRender = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vpRender.width));
    canvas.height = Math.max(1, Math.floor(vpRender.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: vpRender }).promise;

    if (grayscale) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = lum;
        d[i + 1] = lum;
        d[i + 2] = lum;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    const jpgDataUrl = canvas.toDataURL('image/jpeg', cfg.quality);
    const jpgBytes = dataUrlToBytes(jpgDataUrl).bytes;
    const embedded = await outDoc.embedJpg(jpgBytes);
    const outPage = outDoc.addPage([vp1.width, vp1.height]);
    outPage.drawImage(embedded, {
      x: 0,
      y: 0,
      width: vp1.width,
      height: vp1.height,
    });

    onProgress?.(p, total);
  }

  await pdfJsDoc.destroy();
  return outDoc.save({ useObjectStreams: true });
}

// 4. ORGANIZE / DELETE / EXTRACT / ROTATE PAGES
export async function organizePdf(options: {
  bytes: Uint8Array;
  password?: string;
  pages: Array<{ sourcePageIndex: number; rotationDelta: number; width?: number; height?: number }>;
}): Promise<Uint8Array> {
  const srcDoc = await loadPdfLibDocument(options.bytes, options.password);
  const outDoc = await PDFDocument.create();

  for (const item of options.pages) {
    if (item.sourcePageIndex < 0) {
      outDoc.addPage([item.width || 595, item.height || 842]);
    } else {
      const [copied] = await outDoc.copyPages(srcDoc, [item.sourcePageIndex]);
      const added = outDoc.addPage(copied);
      if (item.rotationDelta) {
        const cur = added.getRotation().angle || 0;
        added.setRotation(degrees(normalizeAngle(cur + item.rotationDelta)));
      }
    }
  }

  return outDoc.save({ useObjectStreams: true });
}

// 5. WATERMARK PDF
export type WatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'tiled';

export async function watermarkPdf(options: {
  bytes: Uint8Array;
  password?: string;
  mode: 'text' | 'image';
  text?: string;
  fontFamily?: FontFamilyChoice;
  fontSize?: number;
  color?: string;
  imageDataUrl?: string;
  imageScale?: number;
  opacity: number;
  rotation: number;
  position: WatermarkPosition;
  pageRange?: string;
}): Promise<Uint8Array> {
  const doc = await loadPdfLibDocument(options.bytes, options.password);
  const total = doc.getPageCount();
  const targetIndices = new Set(parsePageRanges(options.pageRange || '', total));
  const pdfPages = doc.getPages();

  const font =
    options.mode === 'text'
      ? await resolveFont(doc, options.fontFamily || 'Helvetica', true, false)
      : null;

  let embeddedImg: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (options.mode === 'image' && options.imageDataUrl) {
    const { bytes, mimeType } = dataUrlToBytes(options.imageDataUrl);
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      embeddedImg = await doc.embedJpg(bytes);
    } else {
      embeddedImg = await doc.embedPng(bytes);
    }
  }

  for (let i = 0; i < total; i += 1) {
    if (!targetIndices.has(i)) continue;
    const page = pdfPages[i];
    const box = page.getCropBox() || page.getMediaBox();
    const pageAngle = normalizeAngle(page.getRotation().angle || 0);
    const vis = getVisualDimensions(box, pageAngle);

    if (options.mode === 'text' && font) {
      const rawText = normalizeCommonPunctuation(options.text || 'CONFIDENTIAL');
      const safeText = isWinAnsiSafe(rawText) ? rawText : 'CONFIDENTIAL';
      const fontSize = options.fontSize || 48;
      const textWidth = font.widthOfTextAtSize(safeText, fontSize);
      const color = hexToPdfRgb(options.color || '#64748b');

      const drawAt = (vx: number, vy: number) => {
        const pt = visualPointToPdf(vx, vy, box, pageAngle);
        page.drawText(safeText, {
          x: pt.x,
          y: pt.y,
          size: fontSize,
          font,
          color,
          opacity: options.opacity,
          rotate: degrees(pageAngle + options.rotation),
        });
      };

      if (options.position === 'tiled') {
        const stepX = Math.max(160, textWidth + 70);
        const stepY = Math.max(130, fontSize * 3);
        for (let ty = 60; ty < vis.height; ty += stepY) {
          for (let tx = 40; tx < vis.width; tx += stepX) {
            drawAt(tx, ty);
          }
        }
      } else {
        const margin = 36;
        let vx = vis.width / 2 - textWidth / 2;
        let vy = vis.height / 2;
        if (options.position.includes('left')) vx = margin;
        if (options.position.includes('right')) vx = Math.max(margin, vis.width - textWidth - margin);
        if (options.position.includes('top')) vy = margin + fontSize;
        if (options.position.includes('bottom')) vy = Math.max(margin + fontSize, vis.height - margin);
        drawAt(vx, vy);
      }
    } else if (options.mode === 'image' && embeddedImg) {
      const scale = options.imageScale || 0.35;
      const w = embeddedImg.width * scale;
      const h = embeddedImg.height * scale;

      const drawImgAt = (vx: number, vy: number) => {
        const pt = visualPointToPdf(vx, vy + h, box, pageAngle);
        page.drawImage(embeddedImg!, {
          x: pt.x,
          y: pt.y,
          width: w,
          height: h,
          opacity: options.opacity,
          rotate: degrees(pageAngle + options.rotation),
        });
      };

      if (options.position === 'tiled') {
        const stepX = Math.max(120, w + 60);
        const stepY = Math.max(120, h + 60);
        for (let ty = 30; ty < vis.height; ty += stepY) {
          for (let tx = 30; tx < vis.width; tx += stepX) {
            drawImgAt(tx, ty);
          }
        }
      } else {
        const margin = 32;
        let vx = (vis.width - w) / 2;
        let vy = (vis.height - h) / 2;
        if (options.position.includes('left')) vx = margin;
        if (options.position.includes('right')) vx = Math.max(margin, vis.width - w - margin);
        if (options.position.includes('top')) vy = margin;
        if (options.position.includes('bottom')) vy = Math.max(margin, vis.height - h - margin);
        drawImgAt(vx, vy);
      }
    }
  }

  return doc.save({ useObjectStreams: true });
}

// 6. HEADER & FOOTER / PAGE NUMBERS
function toRoman(num: number): string {
  const map: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let n = Math.max(1, num);
  let out = '';
  for (const [val, sym] of map) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

export async function headerFooterPdf(options: {
  bytes: Uint8Array;
  fileName: string;
  password?: string;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  fontFamily: FontFamilyChoice;
  fontSize: number;
  color: string;
  marginX: number;
  marginY: number;
  startNumber: number;
  skipFirstPage: boolean;
}): Promise<Uint8Array> {
  const doc = await loadPdfLibDocument(options.bytes, options.password);
  const font = await resolveFont(doc, options.fontFamily, false, false);
  const color = hexToPdfRgb(options.color || '#334155');
  const pages = doc.getPages();
  const total = pages.length;
  const dateStr = new Date().toLocaleDateString();

  const applyTokens = (tpl: string, pageNum: number) => {
    const raw = tpl
      .replace(/\{page\}/gi, String(pageNum))
      .replace(/\{total\}/gi, String(total + (options.startNumber - 1)))
      .replace(/\{roman\}/gi, toRoman(pageNum))
      .replace(/\{date\}/gi, dateStr)
      .replace(/\{filename\}/gi, stripExtension(options.fileName));
    return normalizeCommonPunctuation(raw);
  };

  for (let i = 0; i < total; i += 1) {
    if (options.skipFirstPage && i === 0) continue;
    const page = pages[i];
    const box = page.getCropBox() || page.getMediaBox();
    const angle = normalizeAngle(page.getRotation().angle || 0);
    const vis = getVisualDimensions(box, angle);
    const displayNum = i + options.startNumber;

    const slots: Array<{ text: string; align: 'left' | 'center' | 'right'; isHeader: boolean }> = [
      { text: applyTokens(options.headerLeft, displayNum), align: 'left', isHeader: true },
      { text: applyTokens(options.headerCenter, displayNum), align: 'center', isHeader: true },
      { text: applyTokens(options.headerRight, displayNum), align: 'right', isHeader: true },
      { text: applyTokens(options.footerLeft, displayNum), align: 'left', isHeader: false },
      { text: applyTokens(options.footerCenter, displayNum), align: 'center', isHeader: false },
      { text: applyTokens(options.footerRight, displayNum), align: 'right', isHeader: false },
    ];

    for (const slot of slots) {
      if (!slot.text.trim()) continue;
      const safe = isWinAnsiSafe(slot.text) ? slot.text : slot.text.replace(/[^\x20-\x7E]/g, '');
      if (!safe) continue;
      const textW = font.widthOfTextAtSize(safe, options.fontSize);

      let vx = options.marginX;
      if (slot.align === 'center') vx = (vis.width - textW) / 2;
      else if (slot.align === 'right') vx = Math.max(options.marginX, vis.width - options.marginX - textW);

      const vy = slot.isHeader
        ? options.marginY + options.fontSize
        : vis.height - options.marginY;

      const pt = visualPointToPdf(vx, vy, box, angle);
      page.drawText(safe, {
        x: pt.x,
        y: pt.y,
        size: options.fontSize,
        font,
        color,
        rotate: degrees(angle),
      });
    }
  }

  return doc.save({ useObjectStreams: true });
}

// 7. PROTECT & UNLOCK PDF
export async function protectPdf(options: {
  bytes: Uint8Array;
  currentPassword?: string;
  userPassword: string;
  ownerPassword: string;
  printing: 'highResolution' | 'lowResolution' | 'none';
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
}): Promise<Uint8Array> {
  const doc = await loadPdfLibDocument(options.bytes, options.currentPassword);

  const permissions: {
    printing?: 'lowResolution' | 'highResolution';
    modifying: boolean;
    copying: boolean;
    annotating: boolean;
    fillingForms: boolean;
    contentAccessibility: boolean;
    documentAssembly: boolean;
  } = {
    modifying: options.modifying,
    copying: options.copying,
    annotating: options.annotating,
    fillingForms: options.fillingForms,
    contentAccessibility: options.contentAccessibility,
    documentAssembly: options.documentAssembly,
  };

  if (options.printing !== 'none') {
    permissions.printing = options.printing;
  }

  doc.encrypt({
    userPassword: options.userPassword,
    ownerPassword: options.ownerPassword || options.userPassword,
    permissions,
  });

  return doc.save({ useObjectStreams: false });
}

export async function unlockPdf(options: {
  bytes: Uint8Array;
  password: string;
}): Promise<Uint8Array> {
  const doc = await loadPdfLibDocument(options.bytes, options.password);
  const outDoc = await PDFDocument.create();
  const indices = Array.from({ length: doc.getPageCount() }, (_, i) => i);
  const copied = await outDoc.copyPages(doc, indices);
  copied.forEach((p) => outDoc.addPage(p));
  return outDoc.save({ useObjectStreams: true });
}

// 8. IMAGES TO PDF
export interface ImageToPdfInput {
  name: string;
  dataUrl: string;
  rotation: number;
}

const PAGE_PRESETS: Record<'a4' | 'letter' | 'legal', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

async function normalizeImageToPngOrJpg(
  dataUrl: string,
  rotation: number,
): Promise<{ bytes: Uint8Array; isJpg: boolean; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const norm = normalizeAngle(rotation);
      const swap = norm === 90 || norm === 270;
      const cw = swap ? ih : iw;
      const ch = swap ? iw : ih;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, cw);
      canvas.height = Math.max(1, ch);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }

      ctx.translate(cw / 2, ch / 2);
      ctx.rotate((norm * Math.PI) / 180);
      ctx.drawImage(img, -iw / 2, -ih / 2);

      const isJpgSource = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
      const outMime = isJpgSource ? 'image/jpeg' : 'image/png';
      const outUrl = canvas.toDataURL(outMime, 0.92);
      resolve({
        bytes: dataUrlToBytes(outUrl).bytes,
        isJpg: isJpgSource,
        width: cw,
        height: ch,
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export async function imagesToPdf(options: {
  images: ImageToPdfInput[];
  pageSize: 'auto' | 'a4' | 'letter' | 'legal';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
  fit: 'contain' | 'fill';
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (const item of options.images) {
    const prepared = await normalizeImageToPngOrJpg(item.dataUrl, item.rotation);
    const embedded = prepared.isJpg
      ? await doc.embedJpg(prepared.bytes)
      : await doc.embedPng(prepared.bytes);

    let pageW = prepared.width;
    let pageH = prepared.height;

    if (options.pageSize !== 'auto') {
      const [bw, bh] = PAGE_PRESETS[options.pageSize];
      const useLandscape =
        options.orientation === 'landscape' ||
        (options.orientation === 'auto' && prepared.width > prepared.height);
      pageW = useLandscape ? Math.max(bw, bh) : Math.min(bw, bh);
      pageH = useLandscape ? Math.min(bw, bh) : Math.max(bw, bh);
    } else {
      // Scale oversized camera photos down to comfortable ~72 DPI equivalent cap if huge
      const maxDim = 1440;
      if (pageW > maxDim || pageH > maxDim) {
        const ratio = Math.min(maxDim / pageW, maxDim / pageH);
        pageW *= ratio;
        pageH *= ratio;
      }
      pageW += options.margin * 2;
      pageH += options.margin * 2;
    }

    const page = doc.addPage([pageW, pageH]);
    const availW = Math.max(10, pageW - options.margin * 2);
    const availH = Math.max(10, pageH - options.margin * 2);

    const scale =
      options.fit === 'fill'
        ? Math.max(availW / prepared.width, availH / prepared.height)
        : Math.min(availW / prepared.width, availH / prepared.height);

    const drawW = prepared.width * scale;
    const drawH = prepared.height * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    page.drawImage(embedded, { x, y, width: drawW, height: drawH });
  }

  return doc.save({ useObjectStreams: true });
}

// 9. PDF TO IMAGES
export async function pdfToImages(options: {
  bytes: Uint8Array;
  fileName: string;
  password?: string;
  format: 'png' | 'jpeg';
  dpi: number;
  quality: number;
  pageRange?: string;
  onProgress?: (current: number, total: number) => void;
}): Promise<Array<{ fileName: string; data: Uint8Array; previewUrl: string }>> {
  const doc = await loadPdfJsDocument(options.bytes, options.password);
  const baseName = stripExtension(options.fileName);
  const indices = parsePageRanges(options.pageRange || '', doc.numPages);
  const scale = options.dpi / 72;
  const outputs: Array<{ fileName: string; data: Uint8Array; previewUrl: string }> = [];

  for (let i = 0; i < indices.length; i += 1) {
    const pageNum = indices[i] + 1;
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const mime = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mime, options.quality);
    const ext = options.format === 'jpeg' ? 'jpg' : 'png';

    outputs.push({
      fileName: `${baseName}_page_${String(pageNum).padStart(3, '0')}.${ext}`,
      data: dataUrlToBytes(dataUrl).bytes,
      previewUrl: dataUrl,
    });
    options.onProgress?.(i + 1, indices.length);
  }

  await doc.destroy();
  return outputs;
}

// 10. CROP PDF
export async function cropPdf(options: {
  bytes: Uint8Array;
  password?: string;
  // Normalized margins (0..1) relative to visual top/right/bottom/left
  leftRatio: number;
  topRatio: number;
  rightRatio: number;
  bottomRatio: number;
  applyTo: 'all' | 'odd' | 'even' | 'range';
  pageRange?: string;
}): Promise<Uint8Array> {
  const doc = await loadPdfLibDocument(options.bytes, options.password);
  const pages = doc.getPages();
  const total = pages.length;
  const rangeSet = new Set(parsePageRanges(options.pageRange || '', total));

  for (let i = 0; i < total; i += 1) {
    const pageNum = i + 1;
    if (options.applyTo === 'odd' && pageNum % 2 === 0) continue;
    if (options.applyTo === 'even' && pageNum % 2 !== 0) continue;
    if (options.applyTo === 'range' && !rangeSet.has(i)) continue;

    const page = pages[i];
    const box = page.getCropBox() || page.getMediaBox();
    const angle = normalizeAngle(page.getRotation().angle || 0);
    const vis = getVisualDimensions(box, angle);

    const vx1 = Math.max(0, Math.min(vis.width - 10, options.leftRatio * vis.width));
    const vy1 = Math.max(0, Math.min(vis.height - 10, options.topRatio * vis.height));
    const vx2 = Math.max(vx1 + 10, vis.width - options.rightRatio * vis.width);
    const vy2 = Math.max(vy1 + 10, vis.height - options.bottomRatio * vis.height);

    const p1 = visualPointToPdf(vx1, vy1, box, angle);
    const p2 = visualPointToPdf(vx2, vy2, box, angle);

    const cx = Math.min(p1.x, p2.x);
    const cy = Math.min(p1.y, p2.y);
    const cw = Math.max(10, Math.abs(p2.x - p1.x));
    const ch = Math.max(10, Math.abs(p2.y - p1.y));

    page.setCropBox(cx, cy, cw, ch);
    page.setMediaBox(cx, cy, cw, ch);
  }

  return doc.save({ useObjectStreams: true });
}

// 11. FLATTEN PDF
export async function flattenPdf(options: {
  bytes: Uint8Array;
  password?: string;
  mode: 'forms' | 'fullRaster';
  dpi?: number;
  onProgress?: (current: number, total: number) => void;
}): Promise<Uint8Array> {
  if (options.mode === 'forms') {
    const doc = await loadPdfLibDocument(options.bytes, options.password);
    try {
      const form = doc.getForm();
      form.flatten();
    } catch {
      // No AcroForm fields to flatten
    }
    return doc.save({ useObjectStreams: true });
  }

  const pdfJsDoc = await loadPdfJsDocument(options.bytes, options.password);
  const outDoc = await PDFDocument.create();
  const total = pdfJsDoc.numPages;
  const scale = (options.dpi || 180) / 72;

  for (let p = 1; p <= total; p += 1) {
    const page = await pdfJsDoc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const vpRender = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vpRender.width));
    canvas.height = Math.max(1, Math.floor(vpRender.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vpRender }).promise;

    const pngUrl = canvas.toDataURL('image/png');
    const embedded = await outDoc.embedPng(dataUrlToBytes(pngUrl).bytes);
    const outPage = outDoc.addPage([vp1.width, vp1.height]);
    outPage.drawImage(embedded, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    options.onProgress?.(p, total);
  }

  await pdfJsDoc.destroy();
  return outDoc.save({ useObjectStreams: true });
}

// 12. METADATA INSPECT & UPDATE
export interface PdfMetadataInfo {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export async function readPdfMetadata(
  bytes: Uint8Array,
  password?: string,
): Promise<PdfMetadataInfo> {
  const doc = await loadPdfLibDocument(bytes, password);
  const rawKeywords = doc.getKeywords() as string | string[] | undefined;
  return {
    title: doc.getTitle() || '',
    author: doc.getAuthor() || '',
    subject: doc.getSubject() || '',
    keywords: Array.isArray(rawKeywords) ? rawKeywords.join(', ') : rawKeywords || '',
    creator: doc.getCreator() || '',
    producer: doc.getProducer() || '',
  };
}

export async function updatePdfMetadata(options: {
  bytes: Uint8Array;
  password?: string;
  metadata: PdfMetadataInfo;
}): Promise<Uint8Array> {
  const doc = await loadPdfLibDocument(options.bytes, options.password);
  doc.setTitle(options.metadata.title);
  doc.setAuthor(options.metadata.author);
  doc.setSubject(options.metadata.subject);
  doc.setKeywords(
    options.metadata.keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  doc.setCreator(options.metadata.creator);
  doc.setProducer(options.metadata.producer);

  // Also ensure Info dictionary doesn't retain stale keys if cleared
  if (
    !options.metadata.title &&
    !options.metadata.author &&
    !options.metadata.subject &&
    !options.metadata.keywords
  ) {
    try {
      const infoRef = doc.context.trailerInfo.Info;
      if (infoRef) {
        const dict = doc.context.lookup(infoRef);
        if (dict && 'delete' in dict && typeof (dict as { delete: (k: PDFName) => void }).delete === 'function') {
          const d = dict as { delete: (k: PDFName) => void };
          d.delete(PDFName.of('Title'));
          d.delete(PDFName.of('Author'));
          d.delete(PDFName.of('Subject'));
          d.delete(PDFName.of('Keywords'));
        }
      }
    } catch {
      // Optional cleanup
    }
  }

  return doc.save({ useObjectStreams: true });
}
