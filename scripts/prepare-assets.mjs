import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pdfjsBuildDir = path.join(rootDir, 'node_modules', 'pdfjs-dist', 'build');
const pdfjsCmapsDir = path.join(rootDir, 'node_modules', 'pdfjs-dist', 'cmaps');
const pdfjsFontsDir = path.join(rootDir, 'node_modules', 'pdfjs-dist', 'standard_fonts');
const publicDir = path.join(rootDir, 'public');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

ensureDir(publicDir);

const workerSrc = path.join(pdfjsBuildDir, 'pdf.worker.min.mjs');
const workerDest = path.join(publicDir, 'pdf.worker.min.mjs');

if (fs.existsSync(workerSrc)) {
  fs.copyFileSync(workerSrc, workerDest);
  console.log('[prepare-assets] Copied pdf.worker.min.mjs -> public/pdf.worker.min.mjs');
} else {
  console.warn('[prepare-assets] Warning: pdf.worker.min.mjs not found. Run npm install first.');
}

copyDir(pdfjsCmapsDir, path.join(publicDir, 'cmaps'));
copyDir(pdfjsFontsDir, path.join(publicDir, 'standard_fonts'));
console.log('[prepare-assets] PDF.js assets ready in public/');
