import {
  LineCapStyle,
  PDFArray,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFPage,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib';
import type {
  EditorAnnotation,
  EditorPageState,
  FontFamilyChoice,
  TextAnnotation,
} from '../types/pdf';
import { dataUrlToBytes } from './fileBridge';
import {
  getVisualDimensions,
  hexToPdfRgb,
  isWinAnsiSafe,
  normalizeAngle,
  normalizeCommonPunctuation,
  visualPointToPdf,
  visualRectToPdfRect,
} from './pdfCoords';

type FontCache = Map<string, PDFFont>;

async function getStandardFont(
  doc: PDFDocument,
  cache: FontCache,
  family: FontFamilyChoice,
  bold: boolean,
  italic: boolean,
): Promise<PDFFont> {
  const key = `${family}-${bold ? 'B' : ''}${italic ? 'I' : ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let std: StandardFonts = StandardFonts.Helvetica;
  if (family === 'Helvetica') {
    if (bold && italic) std = StandardFonts.HelveticaBoldOblique;
    else if (bold) std = StandardFonts.HelveticaBold;
    else if (italic) std = StandardFonts.HelveticaOblique;
    else std = StandardFonts.Helvetica;
  } else if (family === 'Times') {
    if (bold && italic) std = StandardFonts.TimesRomanBoldItalic;
    else if (bold) std = StandardFonts.TimesRomanBold;
    else if (italic) std = StandardFonts.TimesRomanItalic;
    else std = StandardFonts.TimesRoman;
  } else if (family === 'Courier') {
    if (bold && italic) std = StandardFonts.CourierBoldOblique;
    else if (bold) std = StandardFonts.CourierBold;
    else if (italic) std = StandardFonts.CourierOblique;
    else std = StandardFonts.Courier;
  }

  const embedded = await doc.embedFont(std);
  cache.set(key, embedded);
  return embedded;
}

async function renderUnicodeTextToPng(ann: TextAnnotation): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
}> {
  const scale = 3;
  const w = Math.max(20, Math.ceil(ann.width));
  const h = Math.max(16, Math.ceil(ann.height));
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create offscreen canvas for Unicode text');

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, w, h);

  const familyCss =
    ann.fontFamily === 'Times'
      ? '"Times New Roman", Georgia, serif'
      : ann.fontFamily === 'Courier'
        ? '"Courier New", Consolas, monospace'
        : '"Segoe UI", Arial, Helvetica, sans-serif';

  ctx.font = `${ann.italic ? 'italic ' : ''}${ann.bold ? 'bold ' : ''}${ann.fontSize}px ${familyCss}`;
  ctx.fillStyle = ann.color || '#111827';
  ctx.textBaseline = 'top';

  const lines = ann.text.split(/\r?\n/);
  const lineHeight = ann.fontSize * 1.25;
  lines.forEach((line, idx) => {
    let drawX = 2;
    if (ann.align === 'center') {
      ctx.textAlign = 'center';
      drawX = w / 2;
    } else if (ann.align === 'right') {
      ctx.textAlign = 'right';
      drawX = w - 2;
    } else {
      ctx.textAlign = 'left';
    }
    ctx.fillText(line, drawX, 2 + idx * lineHeight);
  });

  const dataUrl = canvas.toDataURL('image/png');
  return { bytes: dataUrlToBytes(dataUrl).bytes, width: w, height: h };
}

async function rasterizeDataUrlToPng(dataUrl: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth || img.width);
      canvas.height = Math.max(1, img.naturalHeight || img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const pngUrl = canvas.toDataURL('image/png');
      resolve(dataUrlToBytes(pngUrl).bytes);
    };
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

async function embedAnyImage(doc: PDFDocument, dataUrl: string) {
  const { bytes, mimeType } = dataUrlToBytes(dataUrl);
  if (mimeType === 'image/png') {
    return doc.embedPng(bytes);
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return doc.embedJpg(bytes);
  }
  const pngBytes = await rasterizeDataUrlToPng(dataUrl);
  return doc.embedPng(pngBytes);
}

function appendPageAnnotation(page: PDFPage, doc: PDFDocument, annotDict: ReturnType<PDFDocument['context']['obj']>) {
  const ref = doc.context.register(annotDict);
  let annots = page.node.get(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = doc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  (annots as PDFArray).push(ref);
}

function wrapLinesToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const rawLines = text.split(/\r?\n/);
  const result: string[] = [];
  const safeMax = Math.max(20, maxWidth - 4);

  for (const raw of rawLines) {
    if (!raw) {
      result.push('');
      continue;
    }
    const words = raw.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const w = font.widthOfTextAtSize(candidate, fontSize);
      if (w <= safeMax || !current) {
        current = candidate;
      } else {
        result.push(current);
        current = word;
      }
    }
    result.push(current);
  }
  return result;
}

export async function exportEditedPdf(options: {
  sourceDocs: Array<{ bytes: Uint8Array; password?: string }>;
  pages: EditorPageState[];
}): Promise<Uint8Array> {
  const { sourceDocs, pages } = options;

  const loadedSources = await Promise.all(
    sourceDocs.map((s) =>
      PDFDocument.load(s.bytes, {
        password: s.password || undefined,
        ignoreEncryption: true,
      }),
    ),
  );

  const outDoc = await PDFDocument.create();
  const fontCache: FontCache = new Map();
  const builtPages: PDFPage[] = [];

  // Pass 1: Build page sequence & apply rotations
  for (const pageState of pages) {
    let outPage: PDFPage;
    if (pageState.sourcePageIndex < 0 || pageState.sourceDocIndex < 0) {
      outPage = outDoc.addPage([pageState.baseWidth || 595, pageState.baseHeight || 842]);
    } else {
      const srcDoc = loadedSources[pageState.sourceDocIndex];
      const [copied] = await outDoc.copyPages(srcDoc, [pageState.sourcePageIndex]);
      outPage = outDoc.addPage(copied);
      const baseAngle = outPage.getRotation().angle || 0;
      const newAngle = normalizeAngle(baseAngle + pageState.rotation);
      outPage.setRotation(degrees(newAngle));
    }
    builtPages.push(outPage);
  }

  // Pass 2: Draw annotations and forms onto each page
  for (let i = 0; i < pages.length; i += 1) {
    const pageState = pages[i];
    const pdfPage = builtPages[i];
    const box = pdfPage.getCropBox() || pdfPage.getMediaBox();
    const angle = normalizeAngle(pdfPage.getRotation().angle || 0);
    const visualSize = getVisualDimensions(box, angle);

    for (const ann of pageState.annotations) {
      await drawAnnotationOnPage({
        doc: outDoc,
        page: pdfPage,
        builtPages,
        ann,
        box,
        angle,
        visualWidth: visualSize.width,
        visualHeight: visualSize.height,
        fontCache,
        pageIndex: i,
      });
    }
  }

  return outDoc.save({ useObjectStreams: true });
}

async function drawAnnotationOnPage(params: {
  doc: PDFDocument;
  page: PDFPage;
  builtPages: PDFPage[];
  ann: EditorAnnotation;
  box: { x: number; y: number; width: number; height: number };
  angle: 0 | 90 | 180 | 270;
  visualWidth: number;
  visualHeight: number;
  fontCache: FontCache;
  pageIndex: number;
}) {
  const { doc, page, builtPages, ann, box, angle, fontCache, pageIndex } = params;

  switch (ann.kind) {
    case 'whiteout': {
      const rect = visualRectToPdfRect(ann.x, ann.y, ann.width, ann.height, box, angle);
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: hexToPdfRgb(ann.color || '#ffffff'),
        borderWidth: 0,
      });
      break;
    }

    case 'text': {
      if (ann.coverRect) {
        const cov = visualRectToPdfRect(
          ann.coverRect.x - 1,
          ann.coverRect.y - 1,
          ann.coverRect.width + 2,
          ann.coverRect.height + 2,
          box,
          angle,
        );
        page.drawRectangle({
          x: cov.x,
          y: cov.y,
          width: cov.width,
          height: cov.height,
          color: hexToPdfRgb(ann.coverRect.color || '#ffffff'),
          borderWidth: 0,
        });
      }

      if (!ann.text.trim()) break;
      const sanitized = normalizeCommonPunctuation(ann.text);

      if (isWinAnsiSafe(sanitized)) {
        const font = await getStandardFont(doc, fontCache, ann.fontFamily, ann.bold, ann.italic);
        const lines = wrapLinesToWidth(sanitized, font, ann.fontSize, ann.width);
        const lineHeight = ann.fontSize * 1.25;
        const color = hexToPdfRgb(ann.color || '#111827');

        lines.forEach((line, lineIdx) => {
          if (!line) return;
          const lineW = font.widthOfTextAtSize(line, ann.fontSize);
          let vx = ann.x + 2;
          if (ann.align === 'center') vx = ann.x + Math.max(0, (ann.width - lineW) / 2);
          else if (ann.align === 'right') vx = ann.x + Math.max(0, ann.width - lineW - 2);

          const vyBaseline = ann.y + ann.fontSize * 0.88 + lineIdx * lineHeight;
          const pt = visualPointToPdf(vx, vyBaseline, box, angle);
          page.drawText(line, {
            x: pt.x,
            y: pt.y,
            size: ann.fontSize,
            font,
            color,
            rotate: degrees(angle),
          });
        });
      } else {
        const rendered = await renderUnicodeTextToPng(ann);
        const img = await doc.embedPng(rendered.bytes);
        const pt = visualPointToPdf(ann.x, ann.y + rendered.height, box, angle);
        page.drawImage(img, {
          x: pt.x,
          y: pt.y,
          width: rendered.width,
          height: rendered.height,
          rotate: degrees(angle),
        });
      }
      break;
    }

    case 'image':
    case 'signature': {
      const embedded = await embedAnyImage(doc, ann.dataUrl);
      const pt = visualPointToPdf(ann.x, ann.y + ann.height, box, angle);
      page.drawImage(embedded, {
        x: pt.x,
        y: pt.y,
        width: ann.width,
        height: ann.height,
        opacity: ann.opacity ?? 1,
        rotate: degrees(angle),
      });
      break;
    }

    case 'shape': {
      const opacity = ann.opacity ?? 1;
      if (ann.shapeType === 'rect' || ann.shapeType === 'highlight') {
        const rect = visualRectToPdfRect(ann.x, ann.y, ann.width, ann.height, box, angle);
        const hasFill = ann.fillColor && ann.fillColor !== 'transparent';
        page.drawRectangle({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          color: hasFill ? hexToPdfRgb(ann.fillColor) : undefined,
          borderColor:
            ann.shapeType === 'highlight'
              ? undefined
              : hexToPdfRgb(ann.strokeColor || '#0ea96b'),
          borderWidth: ann.shapeType === 'highlight' ? 0 : ann.strokeWidth || 2,
          opacity,
          borderOpacity: opacity,
        });
      } else if (ann.shapeType === 'ellipse') {
        const cx = ann.x + ann.width / 2;
        const cy = ann.y + ann.height / 2;
        const center = visualPointToPdf(cx, cy, box, angle);
        const hasFill = ann.fillColor && ann.fillColor !== 'transparent';
        const rx = angle === 90 || angle === 270 ? ann.height / 2 : ann.width / 2;
        const ry = angle === 90 || angle === 270 ? ann.width / 2 : ann.height / 2;
        page.drawEllipse({
          x: center.x,
          y: center.y,
          xScale: Math.max(1, rx),
          yScale: Math.max(1, ry),
          color: hasFill ? hexToPdfRgb(ann.fillColor) : undefined,
          borderColor: hexToPdfRgb(ann.strokeColor || '#0ea96b'),
          borderWidth: ann.strokeWidth || 2,
          opacity,
          borderOpacity: opacity,
        });
      } else if (ann.shapeType === 'line' || ann.shapeType === 'arrow') {
        const x1 = ann.x;
        const y1 = ann.y;
        const x2 = ann.x2 ?? ann.x + ann.width;
        const y2 = ann.y2 ?? ann.y + ann.height;
        const p1 = visualPointToPdf(x1, y1, box, angle);
        const p2 = visualPointToPdf(x2, y2, box, angle);
        const color = hexToPdfRgb(ann.strokeColor || '#ef4444');
        const thickness = ann.strokeWidth || 2.5;

        page.drawLine({
          start: p1,
          end: p2,
          thickness,
          color,
          opacity,
          lineCap: LineCapStyle.Round,
        });

        if (ann.shapeType === 'arrow') {
          const vAngle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(8, thickness * 4);
          const spread = Math.PI / 7;
          const ax1 = x2 - headLen * Math.cos(vAngle - spread);
          const ay1 = y2 - headLen * Math.sin(vAngle - spread);
          const ax2 = x2 - headLen * Math.cos(vAngle + spread);
          const ay2 = y2 - headLen * Math.sin(vAngle + spread);

          page.drawLine({
            start: p2,
            end: visualPointToPdf(ax1, ay1, box, angle),
            thickness,
            color,
            opacity,
            lineCap: LineCapStyle.Round,
          });
          page.drawLine({
            start: p2,
            end: visualPointToPdf(ax2, ay2, box, angle),
            thickness,
            color,
            opacity,
            lineCap: LineCapStyle.Round,
          });
        }
      }
      break;
    }

    case 'freehand': {
      if (ann.points.length < 2) break;
      const color = hexToPdfRgb(ann.color || '#0ea96b');
      const opacity = ann.isHighlighter ? Math.min(ann.opacity || 0.35, 0.45) : ann.opacity ?? 1;
      for (let i = 1; i < ann.points.length; i += 1) {
        const prev = visualPointToPdf(ann.points[i - 1].x, ann.points[i - 1].y, box, angle);
        const curr = visualPointToPdf(ann.points[i].x, ann.points[i].y, box, angle);
        page.drawLine({
          start: prev,
          end: curr,
          thickness: ann.strokeWidth || 2.5,
          color,
          opacity,
          lineCap: LineCapStyle.Round,
        });
      }
      break;
    }

    case 'link': {
      const rect = visualRectToPdfRect(ann.x, ann.y, ann.width, ann.height, box, angle);
      const pdfRect = [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];

      if (ann.linkType === 'url' && ann.url.trim()) {
        const annotDict = doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: pdfRect,
          Border: [0, 0, 0],
          A: {
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(ann.url.trim()),
          },
        });
        appendPageAnnotation(page, doc, annotDict);
      } else if (ann.linkType === 'page') {
        const targetIdx = Math.max(0, Math.min(builtPages.length - 1, (ann.targetPage || 1) - 1));
        const targetPage = builtPages[targetIdx];
        if (targetPage) {
          const annotDict = doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: pdfRect,
            Border: [0, 0, 0],
            Dest: [targetPage.ref, PDFName.of('XYZ'), null, null, null],
          });
          appendPageAnnotation(page, doc, annotDict);
        }
      }
      break;
    }

    case 'form': {
      const rect = visualRectToPdfRect(ann.x, ann.y, ann.width, ann.height, box, angle);
      const form = doc.getForm();
      const uniqueName = `${ann.name || 'field'}_${pageIndex + 1}_${ann.id.slice(-5)}`;

      if (ann.fieldType === 'text' || ann.fieldType === 'multiline') {
        const tf = form.createTextField(uniqueName);
        if (ann.fieldType === 'multiline') tf.enableMultiline();
        if (ann.value) tf.setText(normalizeCommonPunctuation(ann.value));
        tf.setFontSize(ann.fontSize || 12);
        tf.addToPage(page, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          borderWidth: 1,
          borderColor: rgb(0.55, 0.62, 0.7),
          backgroundColor: rgb(0.97, 0.99, 1),
        });
      } else if (ann.fieldType === 'checkbox') {
        const cb = form.createCheckBox(uniqueName);
        if (ann.checked) cb.check();
        cb.addToPage(page, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          borderWidth: 1,
          borderColor: rgb(0.4, 0.45, 0.55),
        });
      } else if (ann.fieldType === 'dropdown') {
        const dd = form.createDropdown(uniqueName);
        const opts = ann.options.length > 0 ? ann.options : ['Option 1', 'Option 2'];
        dd.addOptions(opts);
        if (ann.value && opts.includes(ann.value)) dd.select(ann.value);
        dd.addToPage(page, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          borderWidth: 1,
          borderColor: rgb(0.55, 0.62, 0.7),
          backgroundColor: rgb(0.97, 0.99, 1),
        });
      }
      break;
    }

    case 'note': {
      const rect = visualRectToPdfRect(ann.x, ann.y, 24, 24, box, angle);
      const pdfRect = [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
      const safeNote = normalizeCommonPunctuation(ann.text || 'Note');
      const annotDict = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: pdfRect,
        Contents: PDFString.of(safeNote),
        Name: 'Comment',
        C: [0.98, 0.8, 0.08],
      });
      appendPageAnnotation(page, doc, annotDict);
      break;
    }
  }
}
