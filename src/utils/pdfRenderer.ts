import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type {
  DetectedTextBlock,
  FontFamilyChoice,
  PdfOutlineItem,
} from '../types/pdf';

let workerConfigured = false;

export function ensurePdfJsWorker(): void {
  if (workerConfigured) return;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      './pdf.worker.min.mjs',
      window.location.href,
    ).toString();
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
  }
  workerConfigured = true;
}

export class PdfPasswordRequiredError extends Error {
  public readonly reason: 'need_password' | 'incorrect_password';
  constructor(reason: 'need_password' | 'incorrect_password') {
    super(
      reason === 'incorrect_password'
        ? 'The provided PDF password is incorrect.'
        : 'This PDF is password-protected.',
    );
    this.name = 'PdfPasswordRequiredError';
    this.reason = reason;
  }
}

export async function loadPdfJsDocument(
  bytes: Uint8Array,
  password?: string,
): Promise<PDFDocumentProxy> {
  ensurePdfJsWorker();
  // Always clone bytes so pdf.js worker transfer cannot detach caller's buffer.
  const copy = bytes.slice();
  const loadingTask = pdfjsLib.getDocument({
    data: copy,
    password: password || undefined,
    cMapUrl: './cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './standard_fonts/',
  });

  try {
    return await loadingTask.promise;
  } catch (err: unknown) {
    const anyErr = err as { name?: string; code?: number; message?: string };
    if (anyErr?.name === 'PasswordException') {
      if (anyErr.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) {
        throw new PdfPasswordRequiredError('incorrect_password');
      }
      throw new PdfPasswordRequiredError('need_password');
    }
    throw err;
  }
}

export async function getPdfMetadataSummary(
  bytes: Uint8Array,
  password?: string,
): Promise<{ pageCount: number; outline: PdfOutlineItem[] }> {
  const doc = await loadPdfJsDocument(bytes, password);
  const pageCount = doc.numPages;
  const outline: PdfOutlineItem[] = [];

  try {
    const rawOutline = await doc.getOutline();
    if (Array.isArray(rawOutline)) {
      for (const item of rawOutline) {
        if (!item?.title) continue;
        let pageNum = 1;
        try {
          let dest = item.dest;
          if (typeof dest === 'string') {
            dest = await doc.getDestination(dest);
          }
          if (Array.isArray(dest) && dest[0]) {
            const pageIdx = await doc.getPageIndex(dest[0]);
            pageNum = pageIdx + 1;
          }
        } catch {
          pageNum = 1;
        }
        outline.push({ title: item.title, pageNumber: pageNum });
      }
    }
  } catch {
    // Outline optional
  }

  await doc.destroy();
  return { pageCount, outline };
}

export async function renderPageToCanvas(options: {
  page: PDFPageProxy;
  canvas: HTMLCanvasElement;
  scale: number;
  rotationDelta?: number;
}): Promise<{ width: number; height: number }> {
  const { page, canvas, scale, rotationDelta = 0 } = options;
  const effectiveRotation = ((page.rotate + rotationDelta) % 360 + 360) % 360;
  const viewport = page.getViewport({ scale, rotation: effectiveRotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
  });

  await renderTask.promise;
  return { width: viewport.width, height: viewport.height };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function inferFontStyle(fontFamilyRaw: string): {
  fontFamily: FontFamilyChoice;
  bold: boolean;
  italic: boolean;
} {
  const lower = (fontFamilyRaw || '').toLowerCase();
  let fontFamily: FontFamilyChoice = 'Helvetica';
  if (lower.includes('times') || lower.includes('serif') || lower.includes('georgia') || lower.includes('garamond')) {
    fontFamily = 'Times';
  } else if (lower.includes('courier') || lower.includes('mono') || lower.includes('consolas')) {
    fontFamily = 'Courier';
  }
  const bold = lower.includes('bold') || lower.includes('black') || lower.includes('heavy') || lower.includes('700');
  const italic = lower.includes('italic') || lower.includes('oblique');
  return { fontFamily, bold, italic };
}

function sampleRegionColors(
  canvas: HTMLCanvasElement,
  scale: number,
  vx: number,
  vy: number,
  vw: number,
  vh: number,
): { bg: string; fg: string } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { bg: '#ffffff', fg: '#111827' };
  const dpr = canvas.width / Math.max(1, parseFloat(canvas.style.width || String(canvas.width)));
  const factor = scale * dpr;

  const px = Math.max(0, Math.floor(vx * factor));
  const py = Math.max(0, Math.floor(vy * factor));
  const pw = Math.max(1, Math.min(canvas.width - px, Math.ceil(vw * factor)));
  const ph = Math.max(1, Math.min(canvas.height - py, Math.ceil(vh * factor)));

  try {
    const imgData = ctx.getImageData(px, py, pw, ph).data;
    // Sample edge pixels for background color (median-ish brightest cluster)
    const edgeSamples: Array<[number, number, number]> = [];
    for (let x = 0; x < pw; x += Math.max(1, Math.floor(pw / 8))) {
      const topIdx = x * 4;
      const botIdx = ((ph - 1) * pw + x) * 4;
      edgeSamples.push([imgData[topIdx], imgData[topIdx + 1], imgData[topIdx + 2]]);
      edgeSamples.push([imgData[botIdx], imgData[botIdx + 1], imgData[botIdx + 2]]);
    }
    edgeSamples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const bgTuple = edgeSamples[Math.floor(edgeSamples.length * 0.75)] || [255, 255, 255];
    const bgLuma = 0.299 * bgTuple[0] + 0.587 * bgTuple[1] + 0.114 * bgTuple[2];

    // Find pixel with highest contrast against background for foreground ink
    let bestFg: [number, number, number] = bgLuma > 128 ? [17, 24, 39] : [255, 255, 255];
    let bestContrast = 40;
    const step = Math.max(1, Math.floor((pw * ph) / 160));
    for (let i = 0; i < pw * ph; i += step) {
      const idx = i * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const diff = Math.abs(luma - bgLuma);
      if (diff > bestContrast) {
        bestContrast = diff;
        bestFg = [r, g, b];
      }
    }

    return {
      bg: rgbToHex(bgTuple[0], bgTuple[1], bgTuple[2]),
      fg: rgbToHex(bestFg[0], bestFg[1], bestFg[2]),
    };
  } catch {
    return { bg: '#ffffff', fg: '#111827' };
  }
}

export async function extractDetectedTextBlocks(options: {
  page: PDFPageProxy;
  canvas: HTMLCanvasElement;
  scale: number;
  rotationDelta?: number;
}): Promise<DetectedTextBlock[]> {
  const { page, canvas, scale, rotationDelta = 0 } = options;
  const effectiveRotation = ((page.rotate + rotationDelta) % 360 + 360) % 360;
  const viewport1 = page.getViewport({ scale: 1, rotation: effectiveRotation });
  const textContent = await page.getTextContent();

  interface RawSpan {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontName: string;
  }

  const spans: RawSpan[] = [];

  for (const item of textContent.items) {
    if (!('str' in item) || !item.str || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewport1.transform, item.transform);
    const fontHeight = Math.max(6, Math.hypot(tx[2], tx[3]) || item.height || 11);
    const vx = tx[4];
    const baselineY = tx[5];
    const vy = baselineY - fontHeight * 0.85;
    const width = Math.max(4, item.width || item.str.length * fontHeight * 0.5);

    spans.push({
      str: item.str,
      x: vx,
      y: vy,
      width,
      height: fontHeight * 1.18,
      fontSize: Math.round(fontHeight * 10) / 10,
      fontName: item.fontName,
    });
  }

  // Sort top-to-bottom, left-to-right and merge spans on same visual line
  spans.sort((a, b) => {
    if (Math.abs(a.y - b.y) <= Math.max(a.fontSize, b.fontSize) * 0.45) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  const blocks: DetectedTextBlock[] = [];
  let idx = 0;

  for (const span of spans) {
    const prev = blocks[blocks.length - 1];
    const styleEntry = textContent.styles[span.fontName];
    const inferred = inferFontStyle(styleEntry?.fontFamily || span.fontName);

    if (
      prev &&
      Math.abs(prev.y - span.y) <= Math.max(prev.fontSize, span.fontSize) * 0.45 &&
      span.x - (prev.x + prev.width) < Math.max(prev.fontSize, span.fontSize) * 1.6 &&
      span.x >= prev.x - 4
    ) {
      const gap = span.x - (prev.x + prev.width);
      const joiner = gap > prev.fontSize * 0.18 ? ' ' : '';
      prev.text = `${prev.text}${joiner}${span.str}`;
      const newRight = Math.max(prev.x + prev.width, span.x + span.width);
      prev.width = newRight - prev.x;
      prev.height = Math.max(prev.height, span.height);
    } else {
      const sampled = sampleRegionColors(
        canvas,
        scale,
        span.x,
        span.y,
        span.width,
        span.height,
      );
      blocks.push({
        id: `blk-${idx++}`,
        text: span.str,
        x: span.x,
        y: span.y,
        width: span.width,
        height: span.height,
        fontSize: span.fontSize,
        fontFamily: inferred.fontFamily,
        bold: inferred.bold,
        italic: inferred.italic,
        color: sampled.fg,
        backgroundColor: sampled.bg,
      });
    }
  }

  return blocks;
}
