export type ToolId =
  | 'home'
  | 'editor'
  | 'merge'
  | 'split'
  | 'compress'
  | 'organize'
  | 'delete'
  | 'extract'
  | 'rotate'
  | 'watermark'
  | 'headerFooter'
  | 'protect'
  | 'unlock'
  | 'imgToPdf'
  | 'pdfToImg'
  | 'crop'
  | 'flatten'
  | 'metadata';

export type ToolCategory = 'edit' | 'organize' | 'optimize' | 'security';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  category: ToolCategory;
  accent: string;
  badge?: string;
}

export interface LoadedPdfFile {
  id: string;
  name: string;
  path?: string;
  size: number;
  bytes: Uint8Array;
  password?: string;
  pageCount: number;
}

export interface RecentFileRecord {
  name: string;
  path: string;
  size: number;
  lastOpened: number;
}

export type EditorToolMode =
  | 'select'
  | 'text'
  | 'whiteout'
  | 'image'
  | 'signature'
  | 'link'
  | 'formText'
  | 'formCheckbox'
  | 'formDropdown'
  | 'highlight'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'note';

export type FontFamilyChoice = 'Helvetica' | 'Times' | 'Courier';

export interface TextAnnotation {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontFamily: FontFamilyChoice;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  coverRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
  };
  isReplacedExisting?: boolean;
}

export interface WhiteoutAnnotation {
  id: string;
  kind: 'whiteout';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface ImageAnnotation {
  id: string;
  kind: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  opacity: number;
}

export interface SignatureAnnotation {
  id: string;
  kind: 'signature';
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  opacity: number;
}

export interface ShapeAnnotation {
  id: string;
  kind: 'shape';
  shapeType: 'rect' | 'ellipse' | 'line' | 'arrow' | 'highlight';
  x: number;
  y: number;
  width: number;
  height: number;
  x2?: number;
  y2?: number;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
}

export interface FreehandAnnotation {
  id: string;
  kind: 'freehand';
  points: Array<{ x: number; y: number }>;
  color: string;
  strokeWidth: number;
  opacity: number;
  isHighlighter: boolean;
}

export interface LinkAnnotation {
  id: string;
  kind: 'link';
  x: number;
  y: number;
  width: number;
  height: number;
  linkType: 'url' | 'page';
  url: string;
  targetPage: number;
}

export interface FormFieldAnnotation {
  id: string;
  kind: 'form';
  fieldType: 'text' | 'multiline' | 'checkbox' | 'dropdown';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  checked: boolean;
  options: string[];
  fontSize: number;
}

export interface NoteAnnotation {
  id: string;
  kind: 'note';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
}

export type EditorAnnotation =
  | TextAnnotation
  | WhiteoutAnnotation
  | ImageAnnotation
  | SignatureAnnotation
  | ShapeAnnotation
  | FreehandAnnotation
  | LinkAnnotation
  | FormFieldAnnotation
  | NoteAnnotation;

export interface EditorPageState {
  id: string;
  sourceDocIndex: number;
  sourcePageIndex: number; // -1 if blank page
  rotation: number; // relative delta 0, 90, 180, 270
  baseWidth: number; // visual width at 0 relative rotation
  baseHeight: number; // visual height at 0 relative rotation
  annotations: EditorAnnotation[];
}

export interface DetectedTextBlock {
  id: string;
  text: string;
  x: number; // visual PDF pt (scale = 1)
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: FontFamilyChoice;
  bold: boolean;
  italic: boolean;
  color: string;
  backgroundColor: string;
}

export interface SavedSignature {
  id: string;
  label: string;
  dataUrl: string;
  createdAt: number;
}

export interface PdfOutlineItem {
  title: string;
  pageNumber: number; // 1-based
}
