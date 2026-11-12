import React, { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Combine,
  FilePlus2,
  FileText,
  Layers,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { PdfThumbnail } from '../../components/PdfThumbnail';
import { SuccessBanner } from '../../components/SuccessBanner';
import {
  formatBytes,
  parsePageRanges,
  pickFiles,
  saveBinaryFile,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import {
  PdfPasswordRequiredError,
  getPdfMetadataSummary,
  loadPdfJsDocument,
} from '../../utils/pdfRenderer';
import { mergePdfs } from '../../utils/pdfTools';

interface MergeToolProps {
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

interface MergeFileEntry {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  password?: string;
  pageCount: number;
  pageRangeText: string;
  proxy: PDFDocumentProxy;
}

interface VisualPageTile {
  id: string;
  fileId: string;
  fileName: string;
  sourceIndex: number;
  pageIndex: number;
  rotation: number;
  proxy: PDFDocumentProxy;
}

export const MergeTool: React.FC<MergeToolProps> = ({ onBack, onOpenInEditor }) => {
  const [files, setFiles] = useState<MergeFileEntry[]>([]);
  const [mode, setMode] = useState<'files' | 'pages'>('files');
  const [pageTiles, setPageTiles] = useState<VisualPageTile[]>([]);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    queue: SelectedBinaryFile[];
    current: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<{
    fileName: string;
    filePath?: string | null;
    bytes: Uint8Array;
  } | null>(null);

  useEffect(() => {
    return () => {
      files.forEach((f) => f.proxy.destroy().catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rebuildPageTiles = (entries: MergeFileEntry[]) => {
    const tiles: VisualPageTile[] = [];
    entries.forEach((entry, sIdx) => {
      for (let p = 0; p < entry.pageCount; p += 1) {
        tiles.push({
          id: `${entry.id}-p${p}`,
          fileId: entry.id,
          fileName: entry.name,
          sourceIndex: sIdx,
          pageIndex: p,
          rotation: 0,
          proxy: entry.proxy,
        });
      }
    });
    setPageTiles(tiles);
  };

  const ingestFiles = async (incoming: SelectedBinaryFile[], providedPassword?: string) => {
    setError(null);
    const added: MergeFileEntry[] = [];

    for (let i = 0; i < incoming.length; i += 1) {
      const f = incoming[i];
      try {
        const summary = await getPdfMetadataSummary(f.bytes, providedPassword);
        const proxy = await loadPdfJsDocument(f.bytes, providedPassword);
        added.push({
          id: `mf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          size: f.size,
          bytes: f.bytes,
          password: providedPassword,
          pageCount: summary.pageCount,
          pageRangeText: `1-${summary.pageCount}`,
          proxy,
        });
        providedPassword = undefined;
      } catch (err) {
        if (err instanceof PdfPasswordRequiredError) {
          if (added.length > 0) {
            setFiles((prev) => {
              const merged = [...prev, ...added];
              rebuildPageTiles(merged);
              return merged;
            });
          }
          setPendingEncrypted({
            queue: incoming.slice(i + 1),
            current: f,
            error: err.reason === 'incorrect_password' ? 'Incorrect password.' : undefined,
          });
          return;
        }
        setError(`Failed to open ${f.name}: ${String((err as Error)?.message || err)}`);
      }
    }

    if (added.length > 0) {
      setFiles((prev) => {
        const merged = [...prev, ...added];
        rebuildPageTiles(merged);
        return merged;
      });
    }
  };

  const handleAddMore = async () => {
    const picked = await pickFiles({
      title: 'Add PDFs to Merge',
      accept: '.pdf,application/pdf',
      multiple: true,
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });
    if (picked.length > 0) await ingestFiles(picked);
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= files.length) return;
    const next = [...files];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    setFiles(next);
    rebuildPageTiles(next);
  };

  const removeFile = (idx: number) => {
    const target = files[idx];
    target?.proxy.destroy().catch(() => {});
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    rebuildPageTiles(next);
  };

  const moveTile = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pageTiles.length) return;
    const next = [...pageTiles];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    setPageTiles(next);
  };

  const rotateTile = (idx: number) => {
    setPageTiles((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, rotation: (t.rotation + 90) % 360 } : t)),
    );
  };

  const removeTile = (idx: number) => {
    setPageTiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMerge = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      const mergedBytes =
        mode === 'pages'
          ? await mergePdfs(
              files.map((f) => ({ bytes: f.bytes, password: f.password })),
              {
                pageItems: pageTiles.map((t) => ({
                  sourceIndex: files.findIndex((f) => f.id === t.fileId),
                  pageIndex: t.pageIndex,
                  rotation: t.rotation,
                })),
              },
            )
          : await mergePdfs(
              files.map((f) => ({
                bytes: f.bytes,
                password: f.password,
                pageIndices: parsePageRanges(f.pageRangeText, f.pageCount),
              })),
            );

      const defaultName = 'merged_document.pdf';
      const saveRes = await saveBinaryFile({ defaultName, data: mergedBytes });
      if (saveRes.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: saveRes.filePath,
          bytes: mergedBytes,
        });
      }
    } catch (err) {
      setError(`Merge failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
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
            <div className="tool-icon-box" style={{ background: '#2563eb' }}>
              <Combine size={20} />
            </div>
            <div>
              <h1>Merge PDF</h1>
              <p>Combine multiple PDFs by file order or mix individual pages visually.</p>
            </div>
          </div>

          {files.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`btn btn-sm ${mode === 'files' ? 'btn-primary' : ''}`}
                onClick={() => setMode('files')}
              >
                <FileText size={14} /> Files Mode
              </button>
              <button
                className={`btn btn-sm ${mode === 'pages' ? 'btn-primary' : ''}`}
                onClick={() => {
                  rebuildPageTiles(files);
                  setMode('pages');
                }}
              >
                <Layers size={14} /> Visual Pages Mode
              </button>
            </div>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}

        {outputInfo && (
          <SuccessBanner
            title="PDFs merged successfully!"
            outputFileName={outputInfo.fileName}
            outputPath={outputInfo.filePath}
            outputSize={outputInfo.bytes.byteLength}
            onOpenInEditor={() =>
              onOpenInEditor({
                name: outputInfo.fileName,
                path: outputInfo.filePath || undefined,
                size: outputInfo.bytes.byteLength,
                bytes: outputInfo.bytes,
              })
            }
            onReset={() => {
              setOutputInfo(null);
              setFiles([]);
              setPageTiles([]);
            }}
          />
        )}

        {files.length === 0 ? (
          <FileDropzone
            multiple
            title="Drop multiple PDF files here to merge"
            subtitle="Select 2 or more PDF files, reorder them, or choose specific page ranges"
            buttonLabel="Choose PDF Files"
            onFilesSelected={(selected) => ingestFiles(selected)}
          />
        ) : (
          <div className="two-col-tool">
            <div className="panel-card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <strong>
                  {mode === 'files'
                    ? `${files.length} PDF File(s)`
                    : `${pageTiles.length} Pages to Merge`}
                </strong>
                <button className="btn btn-sm" onClick={handleAddMore}>
                  <FilePlus2 size={14} /> Add More PDFs
                </button>
              </div>

              {mode === 'files' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {files.map((f, idx) => (
                    <div
                      key={f.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: 'var(--bg-subtle)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--brand)', width: 22 }}>
                        {idx + 1}.
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {f.pageCount} pages · {formatBytes(f.size)}
                        </div>
                      </div>
                      <div style={{ width: 130 }}>
                        <input
                          type="text"
                          className="input"
                          style={{ padding: '5px 8px', fontSize: 12 }}
                          value={f.pageRangeText}
                          onChange={(e) =>
                            setFiles((prev) =>
                              prev.map((item) =>
                                item.id === f.id ? { ...item, pageRangeText: e.target.value } : item,
                              ),
                            )
                          }
                          title="Pages to include (e.g. 1-3, 5)"
                          placeholder="1-end"
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button
                          className="icon-btn"
                          disabled={idx === 0}
                          onClick={() => moveFile(idx, -1)}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={idx === files.length - 1}
                          onClick={() => moveFile(idx, 1)}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => removeFile(idx)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="thumb-grid">
                  {pageTiles.map((tile, idx) => (
                    <div key={tile.id} className="thumb-card">
                      <div className="thumb-preview-box">
                        <PdfThumbnail
                          pdfDoc={tile.proxy}
                          pageNumber={tile.pageIndex + 1}
                          rotationDelta={tile.rotation}
                          width={126}
                          maxHeight={164}
                        />
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tile.fileName} (p.{tile.pageIndex + 1})
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            className="icon-btn"
                            style={{ width: 26, height: 26 }}
                            disabled={idx === 0}
                            onClick={() => moveTile(idx, -1)}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 26, height: 26 }}
                            disabled={idx === pageTiles.length - 1}
                            onClick={() => moveTile(idx, 1)}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 26, height: 26 }}
                            onClick={() => rotateTile(idx)}
                          >
                            <RotateCw size={13} />
                          </button>
                        </div>
                        <button
                          className="icon-btn"
                          style={{ width: 26, height: 26, color: 'var(--danger)' }}
                          onClick={() => removeTile(idx)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel-card">
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Merge Summary</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
                {mode === 'files'
                  ? 'Files will be combined in top-to-bottom order using the specified page ranges.'
                  : 'Pages will be combined in exact visual tile order with any rotations applied.'}
              </p>
              <button
                className="btn btn-primary btn-lg"
                style={{ width: '100%' }}
                disabled={processing || (mode === 'pages' && pageTiles.length === 0)}
                onClick={handleMerge}
              >
                <Combine size={16} />
                <span>{processing ? 'Merging PDFs...' : 'Merge & Save PDF'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {pendingEncrypted && (
        <PasswordModal
          fileName={pendingEncrypted.current.name}
          errorMessage={pendingEncrypted.error}
          onCancel={() => setPendingEncrypted(null)}
          onSubmit={async (pw) => {
            const cur = pendingEncrypted.current;
            const rest = pendingEncrypted.queue;
            setPendingEncrypted(null);
            await ingestFiles([cur, ...rest], pw);
          }}
        />
      )}
    </div>
  );
};
