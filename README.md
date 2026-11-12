# JadePDF Editor — Sejda-Style Windows Desktop PDF Suite

A complete, 100% offline Windows desktop PDF editor and toolkit built with **Electron + React + TypeScript + PDF.js + `@cantoo/pdf-lib`**, featuring a Sejda-inspired Tools Hub and interactive PDF Editor.

## Included Tools & Capabilities

### Interactive PDF Editor
- **Inline Existing Text Editing**: Click any text line on a PDF page to edit it in place with auto-matched font family, size, text color, and background-matched cover.
- **Add Text, Whiteout & Annotate**: Add styled text boxes, opaque whiteout/redaction patches, highlights, freehand drawing, rectangles, ellipses, lines, arrows, and sticky notes.
- **Signatures**: Draw with pen pad, type in script fonts, upload a signature image, and save signatures for one-click reuse.
- **Images, Links & Fillable Forms**: Insert PNG/JPG/WebP images, create clickable web URL or page-jump link annotations, and place real fillable AcroForm fields (Text Field, Checkbox, Dropdown).
- **Find & Replace**: Search across all pages and replace single or all occurrences automatically.
- **Page Controls & Undo/Redo**: Reorder, rotate, duplicate, delete, insert blank pages, insert pages from external PDFs, full Undo/Redo history, zoom controls, and native Windows printing.

### Dedicated PDF Tools
1. **Merge PDF** — Combine multiple PDFs by file order + page ranges, or visually reorder individual pages.
2. **Split PDF** — Click visual scissors between pages, split every N pages, by page ranges, or by bookmarks (export to folder or `.zip`).
3. **Compress PDF** — Lossless structural optimization or 3 DPI/JPEG quality compression tiers + optional grayscale.
4. **Organize Pages / Delete Pages / Extract Pages / Rotate PDF** — Interactive thumbnail grid with multi-select, odd/even selection, rotate, duplicate, and blank-page insertion.
5. **Watermark** — Text or image logo watermarks in 9 positions or tiled diagonal grid with live preview.
6. **Header & Footer / Page Numbers** — 6-zone header/footer templates with `{page}`, `{total}`, `{roman}`, `{date}`, `{filename}` tokens.
7. **Crop PDF** — Drag visual margin handles directly on the live page preview.
8. **Images to PDF** — Convert JPG, PNG, and WebP images with custom page sizes, orientation, margins, and rotation.
9. **PDF to Images** — Export pages to PNG or JPEG at 72, 150, or 300 DPI.
10. **Protect PDF** — Encrypt with AES-256 open/owner passwords and granular permissions (print, modify, copy, annotate, forms).
11. **Unlock PDF** — Decrypt and strip password protection when you provide the valid password.
12. **Flatten PDF** — Flatten AcroForm fields or rasterize pages permanently.
13. **Edit Metadata** — View, update, or clear Title, Author, Subject, Keywords, Creator, and Producer.

---

## Building the Standalone Windows `.exe`

Once built, the output `.exe` files are **100% standalone desktop software** (Chromium + PDF engine + UI bundled inside one `.exe`, just like Sejda Desktop). **End-users do NOT install Node.js or any extra runtime** — they simply double-click the `.exe`.

Because this project was authored on a machine without Node.js or a Windows build environment, generate the `.exe` once using either option below:

### Option 1: One-Click Build on Any Windows 10/11 PC (No System Node.js Install Needed)
1. Copy the entire `sejda` folder onto a Windows 10 / Windows 11 (x64) PC.
2. Double-click **`build_windows.bat`**.
   - If Node.js is not installed on that PC, the script automatically downloads official portable Node.js locally into `.build-node\` (verified by SHA-256, nothing installed system-wide), compiles everything, and outputs:
     - `release\JadePDF Editor Setup 1.0.0.exe` (Windows Installer with Desktop/Start Menu shortcuts & `.pdf` file association)
     - `release\JadePDF Editor-1.0.0-Portable-x64.exe` (Single standalone zero-install `.exe` — copy and run on any Windows PC!)

### Option 2: Automated Cloud Build via GitHub Actions (Zero Local Tools Needed)
1. Push this folder to a GitHub repository.
2. Open the **Actions** tab and run **Build Windows Standalone EXE** ([`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml)).
3. Download the compiled `JadePDF-Editor-Windows-x64` `.exe` artifact directly.

### Development Mode on Windows
Double-click **`run_dev_windows.bat`** (or run `npm run electron:dev`) to launch the live desktop app immediately.
