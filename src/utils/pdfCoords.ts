import { rgb } from '@cantoo/pdf-lib';

export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeAngle(angle: number): 0 | 90 | 180 | 270 {
  const norm = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (norm === 90 || norm === 180 || norm === 270) return norm;
  return 0;
}

export function getVisualDimensions(box: PdfBox, angle: number): { width: number; height: number } {
  const norm = normalizeAngle(angle);
  if (norm === 90 || norm === 270) {
    return { width: box.height, height: box.width };
  }
  return { width: box.width, height: box.height };
}

export function visualPointToPdf(
  vx: number,
  vy: number,
  box: PdfBox,
  angle: number,
): { x: number; y: number } {
  const norm = normalizeAngle(angle);
  switch (norm) {
    case 90:
      return { x: box.x + vy, y: box.y + vx };
    case 180:
      return { x: box.x + box.width - vx, y: box.y + vy };
    case 270:
      return { x: box.x + box.width - vy, y: box.y + box.height - vx };
    case 0:
    default:
      return { x: box.x + vx, y: box.y + box.height - vy };
  }
}

export function visualRectToPdfRect(
  vx: number,
  vy: number,
  width: number,
  height: number,
  box: PdfBox,
  angle: number,
): PdfBox {
  const p1 = visualPointToPdf(vx, vy, box, angle);
  const p2 = visualPointToPdf(vx + width, vy + height, box, angle);
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

export function hexToPdfRgb(hex: string) {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return rgb(0, 0, 0);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return rgb(r, g, b);
}

const UNICODE_TO_WINANSI: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2013': '-',
  '\u2014': '--',
  '\u2026': '...',
  '\u00A0': ' ',
  '\u2022': '*',
  '\u2212': '-',
};

export function normalizeCommonPunctuation(text: string): string {
  return text.replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0\u2022\u2212]/g, (ch) => {
    return UNICODE_TO_WINANSI[ch] ?? ch;
  });
}

// Checks whether a string can be safely encoded by StandardFonts WinAnsi
export function isWinAnsiSafe(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13 || code === 9) continue;
    if (code >= 32 && code <= 126) continue;
    if (code >= 160 && code <= 255) continue;
    // Standard WinAnsi special code points in 0x2000..0x2122 range
    if (
      code === 0x20ac ||
      code === 0x201a ||
      code === 0x0192 ||
      code === 0x201e ||
      code === 0x2026 ||
      code === 0x2020 ||
      code === 0x2021 ||
      code === 0x02c6 ||
      code === 0x2030 ||
      code === 0x0160 ||
      code === 0x2039 ||
      code === 0x0152 ||
      code === 0x017d ||
      code === 0x2018 ||
      code === 0x2019 ||
      code === 0x201c ||
      code === 0x201d ||
      code === 0x2022 ||
      code === 0x2013 ||
      code === 0x2014 ||
      code === 0x02dc ||
      code === 0x2122 ||
      code === 0x0161 ||
      code === 0x203a ||
      code === 0x0153 ||
      code === 0x017e ||
      code === 0x0178
    ) {
      continue;
    }
    return false;
  }
  return true;
}
