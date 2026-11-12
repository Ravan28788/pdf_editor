import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ArrowLeft, Crop } from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { SuccessBanner } from '../../components/SuccessBanner';
import {
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import {
  PdfPasswordRequiredError,
  loadPdfJsDocument,
  renderPageToCanvas,
} from '../../utils/pdfRenderer';
import { cropPdf } from '../../utils/pdfTools';

interface CropToolProps {
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

export const CropTool: React.FC<CropToolProps> = ({ onBack, onOpenInEditor }) => {
  const [file, setFile] = useState<{
    name: string;
    bytes: Uint8Array;
    password?: string;
    proxy: PDFDocumentProxy;
    pageCount: number;
  } | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const [samplePage, setSamplePage] = useState(1);
  const [leftRatio, setLeftRatio] = useState(0.05);
  const [topRatio, setTopRatio] = useState(0.05);
  const [rightRatio, setRightRatio] = useState(0.05);
  const [bottomRatio, setBottomRatio] = useState(0.05);
  const [applyTo, setApplyTo] = useState<'all' | 'odd' | 'even' | 'range'>('all');
  const [pageRange, setPageRange] = useState('');

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<{
    fileName: string;
    filePath?: string | null;
    bytes: Uint8Array;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 420, height: 590 });

  useEffect(() => {
    return () => {
      file?.proxy.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!file || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const page = await file.proxy.getPage(samplePage);
      if (cancelled || !canvasRef.current) return;
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(460 / vp1.width, 590 / vp1.height);
      const rendered = await renderPageToCanvas({
        page,
        canvas: canvasRef.current,
        scale,
      });
      if (!cancelled) setDims(rendered);
    })();
    return () => {
      cancelled = true;
    };
  }, [file, samplePage]);

  const loadFile = async (selected: SelectedBinaryFile, password?: string) => {
    setError(null);
    setOutputInfo(null);
    try {
      const proxy = await loadPdfJsDocument(selected.bytes, password);
      file?.proxy.destroy().catch(() => {});
      setFile({
        name: selected.name,
        bytes: selected.bytes,
        password,
        proxy,
        pageCount: proxy.numPages,
      });
      setSamplePage(1);
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

  const startEdgeDrag = (
    e: React.MouseEvent,
    edge: 'left' | 'right' | 'top' | 'bottom',
  ) => {
    e.stopPropagation();
    const boxEl = stageRef.current;
    if (!boxEl) return;

    const onMove = (ev: MouseEvent) => {
      const rect = boxEl.getBoundingClientRect();
      const rx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const ry = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      if (edge === 'left') setLeftRatio(Math.min(rx, 1 - rightRatio - 0.08));
      if (edge === 'right') setRightRatio(Math.min(1 - rx, 1 - leftRatio - 0.08));
      if (edge === 'top') setTopRatio(Math.min(ry, 1 - bottomRatio - 0.08));
      if (edge === 'bottom') setBottomRatio(Math.min(1 - ry, 1 - topRatio - 0.08));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleCrop = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const out = await cropPdf({
        bytes: file.bytes,
        password: file.password,
        leftRatio,
        topRatio,
        rightRatio,
        bottomRatio,
        applyTo,
        pageRange,
      });

      const defaultName = `${stripExtension(file.name)}_cropped.pdf`;
      const res = await saveBinaryFile({ defaultName, data: out });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: out,
        });
      }
    } catch (err) {
      setError(`Crop failed: ${String((err as Error)?.message || err)}`);
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
            <div className="tool-icon-box" style={{ background: '#0d9488' }}>
              <Crop size={20} />
            </div>
            <div>
              <h1>Crop PDF</h1>
              <p>Drag the emerald handles on the page preview to trim margins cleanly.</p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {outputInfo && (
          <SuccessBanner
            title="PDF cropped!"
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
              setFile(null);
            }}
          />
        )}

        {!file ? (
          <FileDropzone
            title="Drop a PDF file to crop margins"
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => fs[0] && loadFile(fs[0])}
          />
        ) : (
          <div className="two-col-tool">
            <div
              className="panel-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                background: 'var(--bg-canvas-area)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Preview Page:</span>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={file.pageCount}
                  style={{ width: 72, padding: '4px 8px' }}
                  value={samplePage}
                  onChange={(e) =>
                    setSamplePage(Math.max(1, Math.min(file.pageCount, Number(e.target.value) || 1)))
                  }
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  of {file.pageCount}
                </span>
              </div>

              <div
                ref={stageRef}
                style={{
                  position: 'relative',
                  width: dims.width,
                  height: dims.height,
                  background: '#fff',
                  boxShadow: 'var(--shadow-md)',
                  userSelect: 'none',
                }}
              >
                <canvas ref={canvasRef} style={{ display: 'block' }} />

                {/* Dimmed outside masks */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.35)',
                    clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${leftRatio * 100}% ${topRatio * 100}%, ${leftRatio * 100}% ${(1 - bottomRatio) * 100}%, ${(1 - rightRatio) * 100}% ${(1 - bottomRatio) * 100}%, ${(1 - rightRatio) * 100}% ${topRatio * 100}%, ${leftRatio * 100}% ${topRatio * 100}%)`,
                    pointerEvents: 'none',
                  }}
                />

                {/* Crop selection box */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${leftRatio * 100}%`,
                    top: `${topRatio * 100}%`,
                    right: `${rightRatio * 100}%`,
                    bottom: `${bottomRatio * 100}%`,
                    border: '2px solid #0ea96b',
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    onMouseDown={(e) => startEdgeDrag(e, 'top')}
                    style={{
                      ...handleBase,
                      top: -6,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      cursor: 'ns-resize',
                    }}
                  />
                  <div
                    onMouseDown={(e) => startEdgeDrag(e, 'bottom')}
                    style={{
                      ...handleBase,
                      bottom: -6,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      cursor: 'ns-resize',
                    }}
                  />
                  <div
                    onMouseDown={(e) => startEdgeDrag(e, 'left')}
                    style={{
                      ...handleBase,
                      left: -6,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      cursor: 'ew-resize',
                    }}
                  />
                  <div
                    onMouseDown={(e) => startEdgeDrag(e, 'right')}
                    style={{
                      ...handleBase,
                      right: -6,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      cursor: 'ew-resize',
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="panel-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>Crop Margins (%)</h3>
                <button className="btn btn-sm" onClick={() => setFile(null)}>
                  Change File
                </button>
              </div>

              {[
                { label: 'Left Trim', val: leftRatio, set: setLeftRatio, max: 1 - rightRatio - 0.08 },
                { label: 'Top Trim', val: topRatio, set: setTopRatio, max: 1 - bottomRatio - 0.08 },
                { label: 'Right Trim', val: rightRatio, set: setRightRatio, max: 1 - leftRatio - 0.08 },
                { label: 'Bottom Trim', val: bottomRatio, set: setBottomRatio, max: 1 - topRatio - 0.08 },
              ].map((edge) => (
                <div className="form-group" key={edge.label}>
                  <label className="form-label">
                    {edge.label}: {Math.round(edge.val * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.05, edge.max)}
                    step={0.01}
                    value={edge.val}
                    onChange={(e) => edge.set(Number(e.target.value))}
                  />
                </div>
              ))}

              <div className="form-group">
                <label className="form-label">Apply Crop To</label>
                <select
                  className="select"
                  value={applyTo}
                  onChange={(e) => setApplyTo(e.target.value as typeof applyTo)}
                >
                  <option value="all">All Pages</option>
                  <option value="odd">Odd Pages Only</option>
                  <option value="even">Even Pages Only</option>
                  <option value="range">Custom Page Range</option>
                </select>
              </div>

              {applyTo === 'range' && (
                <div className="form-group">
                  <label className="form-label">Page Range</label>
                  <input
                    className="input"
                    value={pageRange}
                    onChange={(e) => setPageRange(e.target.value)}
                    placeholder="e.g. 1-3, 5"
                  />
                </div>
              )}

              <button
                className="btn btn-primary btn-lg"
                style={{ width: '100%' }}
                disabled={processing}
                onClick={handleCrop}
              >
                <Crop size={16} />
                <span>{processing ? 'Cropping...' : 'Crop & Save PDF'}</span>
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

const handleBase: React.CSSProperties = {
  position: 'absolute',
  width: 12,
  height: 12,
  borderRadius: 99,
  background: '#0ea96b',
  border: '2px solid #ffffff',
  pointerEvents: 'auto',
  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
};
