export interface NativeFileResult {
  path: string;
  name: string;
  size: number;
  data: Uint8Array;
}

export interface OpenFilesOptions {
  title?: string;
  multiSelections?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface SaveFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  data: Uint8Array;
}

export interface SaveMultipleOptions {
  title?: string;
  files: Array<{ fileName: string; data: Uint8Array }>;
}

export interface ElectronAPI {
  platform: string;
  openFiles: (
    options?: OpenFilesOptions,
  ) => Promise<{ canceled: boolean; files: NativeFileResult[] }>;
  saveFile: (
    options: SaveFileOptions,
  ) => Promise<{ canceled: boolean; filePath: string | null }>;
  saveMultipleToFolder: (
    options: SaveMultipleOptions,
  ) => Promise<{ canceled: boolean; folderPath: string | null; savedPaths: string[] }>;
  readFileByPath: (filePath: string) => Promise<NativeFileResult>;
  writeFileByPath: (
    filePath: string,
    data: Uint8Array,
  ) => Promise<{ ok: boolean; filePath: string }>;
  showItemInFolder: (targetPath: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  consumePendingFile: () => Promise<string | null>;
  printPdf: (data: Uint8Array, title?: string) => Promise<boolean>;
  getPathForFile: (file: File) => string;
  onOpenFile: (callback: (filePath: string) => void) => () => void;
  onMenuAction: (callback: (action: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
