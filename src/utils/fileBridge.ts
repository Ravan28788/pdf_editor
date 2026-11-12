import JSZip from 'jszip';
import type { RecentFileRecord } from '../types/pdf';

const RECENT_FILES_KEY = 'jadepdf_recent_files_v1';

export interface SelectedBinaryFile {
  name: string;
  path?: string;
  size: number;
  bytes: Uint8Array;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

export async function pickFiles(options: {
  title?: string;
  accept?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
}): Promise<SelectedBinaryFile[]> {
  if (window.electronAPI) {
    const res = await window.electronAPI.openFiles({
      title: options.title,
      multiSelections: Boolean(options.multiple),
      filters: options.filters,
    });
    if (res.canceled) return [];
    return res.files.map((f) => ({
      name: f.name,
      path: f.path,
      size: f.size,
      bytes: f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data),
    }));
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = Boolean(options.multiple);
    if (options.accept) input.accept = options.accept;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      const results: SelectedBinaryFile[] = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        results.push({
          name: file.name,
          size: file.size,
          bytes: new Uint8Array(buf),
        });
      }
      resolve(results);
    };
    input.click();
  });
}

export async function readDroppedFiles(fileList: FileList | File[]): Promise<SelectedBinaryFile[]> {
  const files = Array.from(fileList);
  const results: SelectedBinaryFile[] = [];
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const nativePath = window.electronAPI ? window.electronAPI.getPathForFile(file) : '';
    results.push({
      name: file.name,
      path: nativePath || undefined,
      size: file.size,
      bytes: new Uint8Array(buf),
    });
  }
  return results;
}

export async function saveBinaryFile(options: {
  defaultName: string;
  data: Uint8Array;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<{ saved: boolean; filePath?: string | null }> {
  if (window.electronAPI) {
    const res = await window.electronAPI.saveFile({
      title: 'Save Output File',
      defaultPath: options.defaultName,
      filters: options.filters || [{ name: 'PDF Document', extensions: ['pdf'] }],
      data: options.data,
    });
    return { saved: !res.canceled, filePath: res.filePath };
  }

  const blob = new Blob([options.data as unknown as BlobPart], {
    type: 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = options.defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { saved: true, filePath: null };
}

export async function saveMultipleFilesAsZip(
  zipName: string,
  files: Array<{ fileName: string; data: Uint8Array }>,
): Promise<{ saved: boolean; filePath?: string | null }> {
  const zip = new JSZip();
  for (const item of files) {
    zip.file(item.fileName, item.data);
  }
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  return saveBinaryFile({
    defaultName: zipName,
    data: zipBytes,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
}

export async function saveMultipleFilesToFolder(
  files: Array<{ fileName: string; data: Uint8Array }>,
): Promise<{ saved: boolean; folderPath?: string | null; count: number }> {
  if (window.electronAPI) {
    const res = await window.electronAPI.saveMultipleToFolder({
      title: 'Select Output Folder',
      files,
    });
    return {
      saved: !res.canceled,
      folderPath: res.folderPath,
      count: res.savedPaths.length,
    };
  }
  const res = await saveMultipleFilesAsZip('output_files.zip', files);
  return { saved: res.saved, folderPath: null, count: res.saved ? files.length : 0 };
}

export function getRecentFiles(): RecentFileRecord[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 8);
  } catch {
    return [];
  }
}

export function recordRecentFile(file: { name: string; path?: string; size: number }): void {
  if (!file.path) return;
  try {
    const existing = getRecentFiles().filter((r) => r.path !== file.path);
    const updated: RecentFileRecord[] = [
      { name: file.name, path: file.path, size: file.size, lastOpened: Date.now() },
      ...existing,
    ].slice(0, 8);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearRecentFiles(): void {
  try {
    localStorage.removeItem(RECENT_FILES_KEY);
  } catch {
    // Ignore
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const [header, b64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mimeType };
}

export function parsePageRanges(rangeText: string, maxPages: number): number[] {
  const cleaned = rangeText.trim();
  if (!cleaned) {
    return Array.from({ length: maxPages }, (_, i) => i);
  }
  const indices: number[] = [];
  const seen = new Set<number>();
  const parts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-').map((s) => s.trim());
      const start = Math.max(1, parseInt(startRaw, 10) || 1);
      const end =
        endRaw.toLowerCase() === 'end'
          ? maxPages
          : Math.min(maxPages, parseInt(endRaw, 10) || maxPages);
      if (start <= end) {
        for (let p = start; p <= end; p += 1) {
          const idx = p - 1;
          if (!seen.has(idx)) {
            seen.add(idx);
            indices.push(idx);
          }
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (num >= 1 && num <= maxPages) {
        const idx = num - 1;
        if (!seen.has(idx)) {
          seen.add(idx);
          indices.push(idx);
        }
      }
    }
  }
  return indices;
}
