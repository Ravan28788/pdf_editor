import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileImage,
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  Package,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { SuccessBanner } from '../../components/SuccessBanner';
import {
  bytesToDataUrl,
  pickFiles,
  saveBinaryFile,
  saveMultipleFilesAsZip,
  saveMultipleFilesToFolder,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import { PdfPasswordRequiredError, getPdfMetadataSummary } from '../../utils/pdfRenderer';
import { imagesToPdf, pdfToImages } from '../../utils/pdfTools';

interface ConvertImagesToolProps {
  mode: 'imgToPdf' | 'pdfToImg';
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

interface ImageItem {
  id: string;
  name: string;
  dataUrl: string;
  rotation: number;
}

export const ConvertImagesTool: React.FC<ConvertImagesToolProps> = ({
  mode,
  onBack,
  onOpenInEditor,
}) => {
  // Image -> PDF state
  const [images, setImages] = useState<ImageItem[]>([]);
  const [pageSize, setPageSize] = useState<'auto' | 'a4' | 'letter' | 'legal'>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [margin, setMargin] = useState(24);
  const [fit, setFit] = useState<'contain' | 'fill'>('contain');

  // PDF -> Images state
  const [pdfFile, setPdfFile] = useState<{
    name: string;
    bytes: Uint8Array;
    password?: string;
    pageCount: number;
  } | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpeg'>('png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.9);
  const [pageRange, setPageRange] = useState('');
  const [exportTarget, setExportTarget] = useState<'folder' | 'zip'>('folder');

  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPdf, setOutputPdf] = useState<{
    fileName: string;
    filePath?: string | null;
    bytes: Uint8Array;
  } | null>(null);
  const [outputMsg, setOutputMsg] = useState<{ title: string; folder?: string | null } | null>(null);
  const [previewGallery, setPreviewGallery] = useState<
    Array<{ fileName: string; previewUrl: string }>
  >([]);

  const ingestImages = async (selected: SelectedBinaryFile[]) => {
    setError(null);
    const items: ImageItem[] = [];
    for (const f of selected) {
      const lower = f.name.toLowerCase();
      const mime =
        lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : lower.endsWith('.webp')
            ? 'image/webp'
            : 'image/png';
      const dataUrl = await bytesToDataUrl(f.bytes, mime);
      items.push({
        id: `im-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        dataUrl,
        rotation: 0,
      });
    }
    setImages((prev) => [...prev, ...items]);
  };

  const loadPdfForImages = async (selected: SelectedBinaryFile, password?: string) => {
    setError(null);
    setOutputMsg(null);
    setPreviewGallery([]);
    try {
      const summary = await getPdfMetadataSummary(selected.bytes, password);
      setPdfFile({
        name: selected.name,
        bytes: selected.bytes,
        password,
        pageCount: summary.pageCount,
      });
    } catch (err) {
      if (err instanceof PdfPasswordRequiredError) {
        setPendingEncrypted({
          file: selected,
          error: err.reason === 'incorrect_password' ? 'Incorrect password.' : undefined,
        });
        return;
      }
      setError(`Could not open PDF: ${String((err as Error)?.message || err)}`);
    }
  };

  const handleBuildPdfFromImages = async () => {
    if (images.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      const bytes = await imagesToPdf({
        images,
        pageSize,
        orientation,
        margin,
        fit,
      });
      const defaultName = 'images_converted.pdf';
      const res = await saveBinaryFile({ defaultName, data: bytes });
      if (res.saved) {
        setOutputPdf({ fileName: defaultName, filePath: res.filePath, bytes });
      }
    } catch (err) {
      setError(`Conversion failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleConvertPdfToImages = async () => {
    if (!pdfFile) return;
    setProcessing(true);
    setError(null);
    setProgress({ current: 0, total: pdfFile.pageCount });
    try {
      const rendered = await pdfToImages({
        bytes: pdfFile.bytes,
        fileName: pdfFile.name,
        password: pdfFile.password,
        format: imgFormat,
        dpi,
        quality,
        pageRange,
        onProgress: (current, total) => setProgress({ current, total }),
      });

      setPreviewGallery(rendered.slice(0, 12).map((r) => ({ fileName: r.fileName, previewUrl: r.previewUrl })));
      const payload = rendered.map((r) => ({ fileName: r.fileName, data: r.data }));

      if (exportTarget === 'zip' || !window.electronAPI) {
        const res = await saveMultipleFilesAsZip(
          `${stripExtension(pdfFile.name)}_images.zip`,
          payload,
        );
        if (res.saved) {
          setOutputMsg({
            title: `Exported ${rendered.length} ${imgFormat.toUpperCase()} image(s) into ZIP!`,
            folder: res.filePath,
          });
        }
      } else {
        const res = await saveMultipleFilesToFolder(payload);
        if (res.saved) {
          setOutputMsg({
            title: `Saved ${res.count} ${imgFormat.toUpperCase()} image(s) to folder!`,
            folder: res.folderPath,
          });
        }
      }
    } catch (err) {
      setError(`Export failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="main-scroll">
      <div className="container-xl">
        <div className="tool-page-header">
          <div className="tool-page-title">
            <button className="btn btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> All Tools
            </button>
            <div
              className="tool-icon-box"
              style={{ background: mode === 'imgToPdf' ? '#9333ea' : '#c026d3' }}
            >
              {mode === 'imgToPdf' ? <ImageIcon size={20} /> : <FileImage size={20} />}
            </div>
            <div>
              <h1>{mode === 'imgToPdf' ? 'Images to PDF' : 'PDF to Images'}</h1>
              <p>
                {mode === 'imgToPdf'
                  ? 'Convert JPG, PNG, and WebP photos into a clean PDF document.'
                  : 'Render PDF pages into high-resolution PNG or JPEG images.'}
              </p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {outputPdf && (
          <SuccessBanner
            title="Images converted to PDF!"
            outputFileName={outputPdf.fileName}
            outputPath={outputPdf.filePath}
            outputSize={outputPdf.bytes.byteLength}
            onOpenInEditor={() =>
              onOpenInEditor({
                name: outputPdf.fileName,
                path: outputPdf.filePath || undefined,
                size: outputPdf.bytes.byteLength,
                bytes: outputPdf.bytes,
              })
            }
            onReset={() => {
              setOutputPdf(null);
              setImages([]);
            }}
          />
        )}

        {outputMsg && (
          <SuccessBanner
            title={outputMsg.title}
            outputPath={outputMsg.folder}
            onReset={() => {
              setOutputMsg(null);
              setPdfFile(null);
              setPreviewGallery([]);
            }}
          />
        )}

        {mode === 'imgToPdf' ? (
          images.length === 0 ? (
            <FileDropzone
              multiple
              title="Drop JPG, PNG, or WebP images here"
              subtitle="Add one or multiple images, reorder or rotate them, and export as a PDF"
              buttonLabel="Choose Images"
              accept="image/png,image/jpeg,image/webp"
              filters={[{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]}
              onFilesSelected={ingestImages}
            />
          ) : (
            <div className="two-col-tool">
              <div className="panel-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                  <strong>{images.length} Image(s)</strong>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      const picked = await pickFiles({
                        title: 'Add More Images',
                        accept: 'image/png,image/jpeg,image/webp',
                        multiple: true,
                        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
                      });
                      if (picked.length) await ingestImages(picked);
                    }}
                  >
                    <FilePlus2 size={14} /> Add Images
                  </button>
                </div>

                <div className="thumb-grid">
                  {images.map((im, idx) => (
                    <div key={im.id} className="thumb-card">
                      <div className="thumb-preview-box">
                        <img
                          src={im.dataUrl}
                          alt={im.name}
                          style={{
                            maxWidth: '92%',
                            maxHeight: '92%',
                            objectFit: 'contain',
                            transform: `rotate(${im.rotation}deg)`,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {idx + 1}. {im.name}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            className="icon-btn"
                            style={{ width: 24, height: 24 }}
                            disabled={idx === 0}
                            onClick={() => {
                              const next = [...images];
                              const [item] = next.splice(idx, 1);
                              next.splice(idx - 1, 0, item);
                              setImages(next);
                            }}
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 24, height: 24 }}
                            disabled={idx === images.length - 1}
                            onClick={() => {
                              const next = [...images];
                              const [item] = next.splice(idx, 1);
                              next.splice(idx + 1, 0, item);
                              setImages(next);
                            }}
                          >
                            <ArrowDown size={12} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 24, height: 24 }}
                            onClick={() =>
                              setImages((prev) =>
                                prev.map((it) =>
                                  it.id === im.id
                                    ? { ...it, rotation: (it.rotation + 90) % 360 }
                                    : it,
                                ),
                              )
                            }
                          >
                            <RotateCw size={12} />
                          </button>
                        </div>
                        <button
                          className="icon-btn"
                          style={{ width: 24, height: 24, color: 'var(--danger)' }}
                          onClick={() => setImages((prev) => prev.filter((it) => it.id !== im.id))}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel-card">
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>PDF Page Options</h3>
                <div className="form-group">
                  <label className="form-label">Page Size</label>
                  <select
                    className="select"
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value as typeof pageSize)}
                  >
                    <option value="a4">A4 (210 × 297 mm)</option>
                    <option value="letter">US Letter (8.5 × 11 in)</option>
                    <option value="legal">Legal (8.5 × 14 in)</option>
                    <option value="auto">Fit to Original Image Size</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Orientation</label>
                  <select
                    className="select"
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as typeof orientation)}
                  >
                    <option value="auto">Auto (Match Image)</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Page Margin ({margin} pt)</label>
                  <input
                    type="range"
                    min={0}
                    max={72}
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Image Scaling</label>
                  <select
                    className="select"
                    value={fit}
                    onChange={(e) => setFit(e.target.value as 'contain' | 'fill')}
                  >
                    <option value="contain">Fit Entire Image (No Cropping)</option>
                    <option value="fill">Fill Page Area</option>
                  </select>
                </div>

                <button
                  className="btn btn-primary btn-lg"
                  style={{ width: '100%' }}
                  disabled={processing}
                  onClick={handleBuildPdfFromImages}
                >
                  <ImageIcon size={16} />
                  <span>{processing ? 'Creating PDF...' : 'Convert to PDF'}</span>
                </button>
              </div>
            </div>
          )
        ) : !pdfFile ? (
          <FileDropzone
            title="Drop a PDF file to convert pages to PNG or JPEG"
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => fs[0] && loadPdfForImages(fs[0])}
          />
        ) : (
          <div className="panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <strong>{pdfFile.name}</strong> ({pdfFile.pageCount} pages)
              </div>
              <button className="btn btn-sm" onClick={() => setPdfFile(null)}>
                Change File
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 14,
                marginBottom: 16,
              }}
            >
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Image Format</label>
                <select
                  className="select"
                  value={imgFormat}
                  onChange={(e) => setImgFormat(e.target.value as 'png' | 'jpeg')}
                >
                  <option value="png">PNG (Lossless Sharp Text)</option>
                  <option value="jpeg">JPEG (Compact Photos)</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Resolution (DPI)</label>
                <select
                  className="select"
                  value={dpi}
                  onChange={(e) => setDpi(Number(e.target.value))}
                >
                  <option value={72}>72 DPI (Screen / Fast)</option>
                  <option value={150}>150 DPI (Standard Quality)</option>
                  <option value={300}>300 DPI (High Print Quality)</option>
                </select>
              </div>

              {imgFormat === 'jpeg' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">JPEG Quality ({Math.round(quality * 100)}%)</label>
                  <input
                    type="range"
                    min={0.4}
                    max={1}
                    step={0.05}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Page Range (optional)</label>
                <input
                  className="input"
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder={`All pages (1-${pdfFile.pageCount})`}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                type="button"
                className={`btn btn-sm ${exportTarget === 'folder' ? 'btn-primary' : ''}`}
                onClick={() => setExportTarget('folder')}
              >
                <FolderOpen size={14} /> Save Images to Folder
              </button>
              <button
                type="button"
                className={`btn btn-sm ${exportTarget === 'zip' ? 'btn-primary' : ''}`}
                onClick={() => setExportTarget('zip')}
              >
                <Package size={14} /> Export as ZIP Archive
              </button>
            </div>

            {progress && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, marginBottom: 6, color: 'var(--text-muted)' }}>
                  Rendering image {progress.current} of {progress.total}...
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <button
              className="btn btn-primary btn-lg"
              disabled={processing}
              onClick={handleConvertPdfToImages}
            >
              <FileImage size={16} />
              <span>{processing ? 'Rendering Images...' : 'Convert & Export Images'}</span>
            </button>

            {previewGallery.length > 0 && (
              <div className="thumb-grid" style={{ marginTop: 20 }}>
                {previewGallery.map((item) => (
                  <div key={item.fileName} className="thumb-card">
                    <div className="thumb-preview-box">
                      <img
                        src={item.previewUrl}
                        alt={item.fileName}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                      />
                    </div>
                    <div style={{ fontSize: 11.5, textAlign: 'center', fontWeight: 600 }}>
                      {item.fileName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {pendingEncrypted && (
        <PasswordModal
          fileName={pendingEncrypted.file.name}
          errorMessage={pendingEncrypted.error}
          onCancel={() => setPendingEncrypted(null)}
          onSubmit={(pw) => {
            const target = pendingEncrypted.file;
            setPendingEncrypted(null);
            loadPdfForImages(target, pw);
          }}
        />
      )}
    </div>
  );
};
