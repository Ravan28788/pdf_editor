import type { ToolDefinition } from '../types/pdf';

export const TOOLS_CATALOG: ToolDefinition[] = [
  {
    id: 'editor',
    name: 'PDF Editor',
    description:
      'Edit existing text inline, add text, signatures, images, whiteout, shapes, links, and fillable forms.',
    category: 'edit',
    accent: '#0ea96b',
    badge: 'Flagship',
  },
  {
    id: 'merge',
    name: 'Merge PDF',
    description:
      'Combine multiple PDF files or mix and reorder individual pages visually into one document.',
    category: 'organize',
    accent: '#2563eb',
    badge: 'Popular',
  },
  {
    id: 'split',
    name: 'Split PDF',
    description:
      'Split by visual scissors, page ranges, every N pages, or PDF bookmarks into separate files or ZIP.',
    category: 'organize',
    accent: '#0891b2',
  },
  {
    id: 'compress',
    name: 'Compress PDF',
    description:
      'Reduce PDF file size using lossless optimization or high/medium/low quality presets.',
    category: 'optimize',
    accent: '#d97706',
    badge: 'Popular',
  },
  {
    id: 'organize',
    name: 'Organize Pages',
    description:
      'Reorder, rotate, duplicate, insert blank pages, and manage your PDF layout visually.',
    category: 'organize',
    accent: '#4f46e5',
  },
  {
    id: 'delete',
    name: 'Delete Pages',
    description:
      'Select and remove unwanted pages from any PDF document in seconds.',
    category: 'organize',
    accent: '#dc2626',
  },
  {
    id: 'extract',
    name: 'Extract Pages',
    description:
      'Pick specific pages from a PDF and save them together as a brand new PDF document.',
    category: 'organize',
    accent: '#0284c7',
  },
  {
    id: 'rotate',
    name: 'Rotate PDF',
    description:
      'Rotate individual pages or the entire document 90°, 180°, or 270° permanently.',
    category: 'organize',
    accent: '#7c3aed',
  },
  {
    id: 'watermark',
    name: 'Watermark',
    description:
      'Stamp custom text or logo image watermarks in single position or tiled diagonal layout.',
    category: 'edit',
    accent: '#059669',
  },
  {
    id: 'headerFooter',
    name: 'Header & Footer',
    description:
      'Add page numbers, dates, filenames, and custom headers or footers across pages.',
    category: 'edit',
    accent: '#10b981',
  },
  {
    id: 'crop',
    name: 'Crop PDF',
    description:
      'Trim margins interactively with a visual crop box across all, odd, even, or selected pages.',
    category: 'edit',
    accent: '#0d9488',
  },
  {
    id: 'imgToPdf',
    name: 'Images to PDF',
    description:
      'Convert JPG, PNG, and WebP images into a PDF with custom page sizes, orientation, and margins.',
    category: 'optimize',
    accent: '#9333ea',
  },
  {
    id: 'pdfToImg',
    name: 'PDF to Images',
    description:
      'Export PDF pages as crisp PNG or JPEG images at 72, 150, or 300 DPI.',
    category: 'optimize',
    accent: '#c026d3',
  },
  {
    id: 'protect',
    name: 'Protect PDF',
    description:
      'Encrypt PDFs with AES-256 open/owner passwords and restrict printing, copying, or editing.',
    category: 'security',
    accent: '#e11d48',
  },
  {
    id: 'unlock',
    name: 'Unlock PDF',
    description:
      'Remove password protection and editing restrictions from PDFs you are authorized to unlock.',
    category: 'security',
    accent: '#be123c',
  },
  {
    id: 'flatten',
    name: 'Flatten PDF',
    description:
      'Flatten interactive form fields or rasterize pages so contents can no longer be altered.',
    category: 'optimize',
    accent: '#475569',
  },
  {
    id: 'metadata',
    name: 'Edit Metadata',
    description:
      'View, update, or scrub Title, Author, Subject, Keywords, and Creator metadata.',
    category: 'security',
    accent: '#334155',
  },
];
