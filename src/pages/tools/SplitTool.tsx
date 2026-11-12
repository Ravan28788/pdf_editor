import React, { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ArrowLeft, FolderOpen, Package, Scissors } from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { PdfThumbnail } from '../../components/PdfThumbnail';
import { SuccessBanner } from '../../components/SuccessBanner';
import type { PdfOutlineItem } from '../../types/pdf';
import {
  saveMultipleFilesAsZip,
  saveMultipleFilesToFolder,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import {
  PdfPasswordRequiredError,
  getPdfMetadataSummary,
  loadPdfJsDocument,
} from '../../utils/pdfRenderer';
import { splitPdf, type SplitMode } from '../../utils/pdfTools';

interface SplitToolProps {
  onBack: () => void;
}

export const SplitTool: React.FC<SplitToolProps> = ({ onBack }) => {
  const [file, setFile] = useState<{
    name: string;
    bytes: Uint8Array;
    password?: string;
    pageCount: number;
    outline: PdfOutlineItem[];
    proxy: PDFDocumentProxy;
  } | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const [mode, setMode] = useState<SplitMode>('cutPoints');
  const [everyN, setEveryN] = useState(1);
  const [rangesText, setRangesText] = useState('1-2, 3-end');
  const [cuts, setCuts] = useState<number[]>([]);
  const [exportFormat, setExportFormat] = useState<'folder' | 'zip'>('folder');

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<{ title: string; folder?: string | null } | null>(
    null,
  );

  useEffect(() => {
    return () => {
      file?.proxy.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFile = async (selected: SelectedBinaryFile, password?: string) => {
    setError(null);
    setSuccessMsg(null);
    try {
      const summary = await getPdfMetadataSummary(selected.bytes, password);
      const proxy = await loadPdfJsDocument(selected.bytes, password);
      file?.proxy.destroy().catch(() => {});
      setFile({
        name: selected.name,
        bytes: selected.bytes,
        password,
        pageCount: summary.pageCount,
        outline: summary.outline,
        proxy,
      });
      setCuts([]);
      setRangesText(summary.pageCount > 1 ? `1-1, 2-${summary.pageCount}` : '1');
    } catch (err) {
      if (err instanceof PdfPasswordRequiredError) {
        setPendingEncrypted({
          file: selected,
          error: err.reason === 'incorrect_password' ? 'Incorrect password.' : undefined,
        });
        return;
      }
      setError(`Unable to load PDF: ${String((err as Error)?.message || err)}`);
    }
  };

  const toggleCutAfter = (pageNum: number) => {
    setCuts((prev) =>
      prev.includes(pageNum) ? prev.filter((p) => p !== pageNum) : [...prev, pageNum].sort((a, b) => a - b),
    );
  };

  const handleSplit = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const parts = await splitPdf({
        bytes: file.bytes,
        fileName: file.name,
        password: file.password,
        mode,
        everyN,
        rangesText,
        cutAfterPages: cuts,
      });

      const payload = parts.map((p) => ({ fileName: p.fileName, data: p.data }));

      if (exportFormat === 'zip' || !window.electronAPI) {
        const res = await saveMultipleFilesAsZip(`${stripExtension(file.name)}_split.zip`, payload);
        if (res.saved) {
          setSuccessMsg({
            title: `Split into ${parts.length} PDF files inside ZIP archive!`,
            folder: res.filePath,
          });
        }
      } else {
        const res = await saveMultipleFilesToFolder(payload);
        if (res.saved) {
          setSuccessMsg({
            title: `Saved ${res.count} split PDF files!`,
            folder: res.folderPath,
          });
        }
      }
    } catch (err) {
      setError(`Split failed: ${String((err as Error)?.message || err)}`);
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
            <div className="tool-icon-box" style={{ background: '#0891b2' }}>
              <Scissors size={20} />
            </div>
            <div>
              <h1>Split PDF</h1>
              <p>Click scissors between pages, split every N pages, by range, or by bookmarks.</p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {successMsg && (
          <SuccessBanner
            title={successMsg.title}
            outputPath={successMsg.folder}
            onReset={() => {
              setSuccessMsg(null);
              setFile(null);
            }}
          />
        )}

        {!file ? (
          <FileDropzone
            title="Drop a PDF file to split"
            subtitle="Split visually page-by-page or extract multiple custom page ranges"
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => fs[0] && loadFile(fs[0])}
          />
        ) : (
          <div className="two-col-tool">
            <div className="panel-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <strong>
                  {file.name} ({file.pageCount} pages)
                </strong>
                <button className="btn btn-sm" onClick={() => setFile(null)}>
                  Change File
                </button>
              </div>

              {mode === 'cutPoints' ? (
                <>
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
                    Click the scissors icon after any page where you want to split into a new PDF.
                    Currently creating <strong>{cuts.length + 1}</strong> output file(s).
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    {Array.from({ length: file.pageCount }, (_, i) => i + 1).map((pageNum) => {
                      const hasCut = cuts.includes(pageNum);
                      return (
                        <React.Fragment key={pageNum}>
                          <div className="thumb-card" style={{ width: 132, alignItems: 'center' }}>
                            <PdfThumbnail pdfDoc={file.proxy} pageNumber={pageNum} width={110} maxHeight={144} />
                            <span style={{ fontSize: 12, fontWeight: 600 }}>Page {pageNum}</span>
                          </div>
                          {pageNum < file.pageCount && (
                            <button
                              type="button"
                              onClick={() => toggleCutAfter(pageNum)}
                              title={hasCut ? 'Remove split here' : 'Split after this page'}
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: '50%',
                                border: hasCut ? '2px solid var(--brand)' : '1px dashed var(--border-strong)',
                                background: hasCut ? 'var(--brand)' : 'var(--bg-surface)',
                                color: hasCut ? '#fff' : 'var(--text-muted)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Scissors size={15} />
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="thumb-grid">
                  {Array.from({ length: Math.min(file.pageCount, 24) }, (_, i) => i + 1).map(
                    (pageNum) => (
                      <div key={pageNum} className="thumb-card" style={{ alignItems: 'center' }}>
                        <PdfThumbnail pdfDoc={file.proxy} pageNumber={pageNum} width={120} maxHeight={154} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Page {pageNum}</span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>

            <div className="panel-card">
              <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Split Options</h3>

              <div className="form-group">
                <label className="form-label">Split Method</label>
                <div className="option-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {[
                    { id: 'cutPoints', label: 'Visual Scissors' },
                    { id: 'everyN', label: 'Every N Pages' },
                    { id: 'ranges', label: 'Page Ranges' },
                    { id: 'bookmarks', label: 'By Bookmarks' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`option-card ${mode === m.id ? 'selected' : ''}`}
                      onClick={() => setMode(m.id as SplitMode)}
                    >
                      <strong style={{ fontSize: 12.5 }}>{m.label}</strong>
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'everyN' && (
                <div className="form-group">
                  <label className="form-label">Pages per Split File</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={file.pageCount}
                    value={everyN}
                    onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              )}

              {mode === 'ranges' && (
                <div className="form-group">
                  <label className="form-label">Comma-separated Ranges (1 file per item)</label>
                  <input
                    type="text"
                    className="input"
                    value={rangesText}
                    onChange={(e) => setRangesText(e.target.value)}
                    placeholder="e.g. 1-3, 4-6, 7-end"
                  />
                </div>
              )}

              {mode === 'bookmarks' && (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14 }}>
                  Detected <strong>{file.outline.length}</strong> top-level bookmark(s) in this PDF.
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Save Format</label>
                <div className="option-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <button
                    type="button"
                    className={`option-card ${exportFormat === 'folder' ? 'selected' : ''}`}
                    onClick={() => setExportFormat('folder')}
                  >
                    <FolderOpen size={15} style={{ marginBottom: 4 }} />
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>Save to Folder</div>
                  </button>
                  <button
                    type="button"
                    className={`option-card ${exportFormat === 'zip' ? 'selected' : ''}`}
                    onClick={() => setExportFormat('zip')}
                  >
                    <Package size={15} style={{ marginBottom: 4 }} />
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>ZIP Archive</div>
                  </button>
                </div>
              </div>

              <button
                className="btn btn-primary btn-lg"
                style={{ width: '100%' }}
                disabled={processing}
                onClick={handleSplit}
              >
                <Scissors size={16} />
                <span>{processing ? 'Splitting PDF...' : 'Split & Save PDFs'}</span>
              </button>
            </div>
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
            loadFile(target, pw);
          }}
        />
      )}
    </div>
  );
};
