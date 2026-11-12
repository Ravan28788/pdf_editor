import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ArrowLeft, Stamp, Upload } from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { SuccessBanner } from '../../components/SuccessBanner';
import type { FontFamilyChoice } from '../../types/pdf';
import {
  bytesToDataUrl,
  pickFiles,
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import {
  PdfPasswordRequiredError,
  loadPdfJsDocument,
  renderPageToCanvas,
} from '../../utils/pdfRenderer';
import { watermarkPdf, type WatermarkPosition } from '../../utils/pdfTools';

interface WatermarkToolProps {
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

const POSITIONS: WatermarkPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

export const WatermarkTool: React.FC<WatermarkToolProps> = ({ onBack, onOpenInEditor }) => {
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

  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontFamily, setFontFamily] = useState<FontFamilyChoice>('Helvetica');
  const [fontSize, setFontSize] = useState(46);
  const [color, setColor] = useState('#64748b');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(0.35);
  const [opacity, setOpacity] = useState(0.32);
  const [rotation, setRotation] = useState(-35);
  const [position, setPosition] = useState<WatermarkPosition>('center');
  const [pageRange, setPageRange] = useState('');

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<{
    fileName: string;
    filePath?: string | null;
    bytes: Uint8Array;
  } | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 420, height: 590, scale: 0.7 });

  useEffect(() => {
    return () => {
      file?.proxy.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!file || !previewCanvasRef.current) return;
    let cancelled = false;
    (async () => {
      const page = await file.proxy.getPage(1);
      if (cancelled || !previewCanvasRef.current) return;
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(440 / vp1.width, 580 / vp1.height);
      const dims = await renderPageToCanvas({
        page,
        canvas: previewCanvasRef.current,
        scale,
      });
      if (!cancelled) {
        setPreviewSize({ width: dims.width, height: dims.height, scale });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

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

  const pickWatermarkImage = async () => {
    const picked = await pickFiles({
      title: 'Select Watermark Image',
      accept: 'image/png,image/jpeg',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (!picked.length) return;
    const f = picked[0];
    const mime = f.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    setImageDataUrl(await bytesToDataUrl(f.bytes, mime));
  };

  const handleApply = async () => {
    if (!file) return;
    if (mode === 'image' && !imageDataUrl) {
      setError('Please choose a watermark image first.');
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const out = await watermarkPdf({
        bytes: file.bytes,
        password: file.password,
        mode,
        text,
        fontFamily,
        fontSize,
        color,
        imageDataUrl: imageDataUrl || undefined,
        imageScale,
        opacity,
        rotation,
        position,
        pageRange,
      });

      const defaultName = `${stripExtension(file.name)}_watermarked.pdf`;
      const res = await saveBinaryFile({ defaultName, data: out });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: out,
        });
      }
    } catch (err) {
      setError(`Watermark failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
    }
  };

  const getOverlayPositionStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      pointerEvents: 'none',
      opacity,
      transform: `rotate(${-rotation}deg)`,
    };
    if (position.includes('top')) base.top = '10%';
    else if (position.includes('bottom')) base.bottom = '10%';
    else base.top = '50%';

    if (position.includes('left')) base.left = '8%';
    else if (position.includes('right')) base.right = '8%';
    else base.left = '50%';

    const tx = position.includes('left') || position.includes('right') ? '0' : '-50%';
    const ty = position.includes('top') || position.includes('bottom') ? '0' : '-50%';
    base.transform = `translate(${tx}, ${ty}) rotate(${-rotation}deg)`;
    return base;
  };

  return (
    <div className="main-scroll">
      <div className="container-xl">
        <div className="tool-page-header">
          <div className="tool-page-title">
            <button className="btn btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> All Tools
            </button>
            <div className="tool-icon-box" style={{ background: '#059669' }}>
              <Stamp size={20} />
            </div>
            <div>
              <h1>Watermark PDF</h1>
              <p>Add text or logo watermarks with live placement preview.</p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {outputInfo && (
          <SuccessBanner
            title="Watermark applied!"
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
            title="Drop a PDF file to add a watermark"
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
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text-muted)' }}>
                Live Page 1 Preview ({file.name})
              </div>
              <div
                style={{
                  position: 'relative',
                  width: previewSize.width,
                  height: previewSize.height,
                  background: '#fff',
                  boxShadow: 'var(--shadow-md)',
                  overflow: 'hidden',
                }}
              >
                <canvas ref={previewCanvasRef} style={{ display: 'block' }} />

                {position === 'tiled' ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gridTemplateRows: 'repeat(4, 1fr)',
                      alignItems: 'center',
                      justifyItems: 'center',
                      pointerEvents: 'none',
                      opacity,
                    }}
                  >
                    {Array.from({ length: 12 }).map((_, idx) => (
                      <div
                        key={idx}
                        style={{
                          transform: `rotate(${-rotation}deg)`,
                          color,
                          fontWeight: 700,
                          fontSize: Math.max(10, fontSize * previewSize.scale * 0.65),
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {mode === 'text' ? (
                          text || 'CONFIDENTIAL'
                        ) : imageDataUrl ? (
                          <img
                            src={imageDataUrl}
                            alt=""
                            style={{ maxWidth: 80, maxHeight: 60 }}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={getOverlayPositionStyle()}>
                    {mode === 'text' ? (
                      <span
                        style={{
                          color,
                          fontWeight: 700,
                          fontFamily:
                            fontFamily === 'Times'
                              ? 'Georgia, serif'
                              : fontFamily === 'Courier'
                                ? 'monospace'
                                : 'sans-serif',
                          fontSize: Math.max(10, fontSize * previewSize.scale),
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {text || 'CONFIDENTIAL'}
                      </span>
                    ) : imageDataUrl ? (
                      <img
                        src={imageDataUrl}
                        alt=""
                        style={{
                          width: Math.max(30, 260 * imageScale * previewSize.scale),
                        }}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="panel-card">
              <div className="option-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
                <button
                  type="button"
                  className={`option-card ${mode === 'text' ? 'selected' : ''}`}
                  onClick={() => setMode('text')}
                >
                  <strong>Text Watermark</strong>
                </button>
                <button
                  type="button"
                  className={`option-card ${mode === 'image' ? 'selected' : ''}`}
                  onClick={() => setMode('image')}
                >
                  <strong>Image / Logo</strong>
                </button>
              </div>

              {mode === 'text' ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Watermark Text</label>
                    <input
                      type="text"
                      className="input"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 56px', gap: 8, marginBottom: 14 }}>
                    <select
                      className="select"
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value as FontFamilyChoice)}
                    >
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times">Times</option>
                      <option value="Courier">Courier</option>
                    </select>
                    <input
                      type="number"
                      className="input"
                      min={10}
                      max={140}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value) || 40)}
                    />
                    <input
                      type="color"
                      className="input"
                      style={{ padding: 2, height: 36 }}
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="form-group">
                  <button type="button" className="btn" onClick={pickWatermarkImage}>
                    <Upload size={14} /> {imageDataUrl ? 'Replace Logo Image' : 'Choose PNG / JPG Logo'}
                  </button>
                  <label className="form-label" style={{ marginTop: 10 }}>
                    Image Scale ({Math.round(imageScale * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={imageScale}
                    onChange={(e) => setImageScale(Number(e.target.value))}
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Opacity ({Math.round(opacity * 100)}%)</label>
                <input
                  type="range"
                  min={0.08}
                  max={1}
                  step={0.02}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Rotation ({rotation}°)</label>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  step={5}
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Position</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 6 }}>
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      className={`btn btn-sm ${position === pos ? 'btn-primary' : ''}`}
                      onClick={() => setPosition(pos)}
                      style={{ fontSize: 11 }}
                    >
                      {pos.replace('-', ' ')}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${position === 'tiled' ? 'btn-primary' : ''}`}
                  style={{ width: '100%' }}
                  onClick={() => setPosition('tiled')}
                >
                  Repeat / Tile Across Page
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Page Range (optional, e.g. 1-3, 5)</label>
                <input
                  type="text"
                  className="input"
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder={`All pages (1-${file.pageCount})`}
                />
              </div>

              <button
                className="btn btn-primary btn-lg"
                style={{ width: '100%' }}
                disabled={processing}
                onClick={handleApply}
              >
                <Stamp size={16} />
                <span>{processing ? 'Applying Watermark...' : 'Add Watermark & Save'}</span>
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
