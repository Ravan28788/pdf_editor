import React, { useState } from 'react';
import { ArrowLeft, Minimize2 } from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { SuccessBanner } from '../../components/SuccessBanner';
import {
  formatBytes,
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import { PdfPasswordRequiredError, getPdfMetadataSummary } from '../../utils/pdfRenderer';
import { compressPdf, type CompressionPreset } from '../../utils/pdfTools';

interface CompressToolProps {
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

export const CompressTool: React.FC<CompressToolProps> = ({ onBack, onOpenInEditor }) => {
  const [file, setFile] = useState<{
    name: string;
    size: number;
    bytes: Uint8Array;
    password?: string;
    pageCount: number;
  } | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const [preset, setPreset] = useState<CompressionPreset>('medium');
  const [grayscale, setGrayscale] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<{
    fileName: string;
    filePath?: string | null;
    bytes: Uint8Array;
  } | null>(null);

  const loadFile = async (selected: SelectedBinaryFile, password?: string) => {
    setError(null);
    setOutputInfo(null);
    try {
      const summary = await getPdfMetadataSummary(selected.bytes, password);
      setFile({
        name: selected.name,
        size: selected.size,
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

  const handleCompress = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    setProgress({ current: 0, total: file.pageCount });
    try {
      const compressed = await compressPdf({
        bytes: file.bytes,
        password: file.password,
        preset,
        grayscale,
        onProgress: (current, total) => setProgress({ current, total }),
      });

      const defaultName = `${stripExtension(file.name)}_compressed.pdf`;
      const res = await saveBinaryFile({ defaultName, data: compressed });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: compressed,
        });
      }
    } catch (err) {
      setError(`Compression failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="main-scroll">
      <div className="container-lg">
        <div className="tool-page-header">
          <div className="tool-page-title">
            <button className="btn btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> All Tools
            </button>
            <div className="tool-icon-box" style={{ background: '#d97706' }}>
              <Minimize2 size={20} />
            </div>
            <div>
              <h1>Compress PDF</h1>
              <p>Optimize PDF structure or re-sample pages for maximum file size savings.</p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {outputInfo && file && (
          <SuccessBanner
            title="PDF compressed!"
            outputFileName={outputInfo.fileName}
            outputPath={outputInfo.filePath}
            outputSize={outputInfo.bytes.byteLength}
            originalSize={file.size}
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
            title="Drop a PDF file to compress"
            subtitle="Shrink large scans and reports offline while preserving readability"
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => fs[0] && loadFile(fs[0])}
          />
        ) : (
          <div className="panel-card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <div>
                <strong>{file.name}</strong>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Original Size: {formatBytes(file.size)} · {file.pageCount} pages
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => setFile(null)}>
                Change File
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Compression Level</label>
              <div className="option-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {[
                  {
                    id: 'lossless',
                    title: 'Lossless Structural',
                    desc: 'Preserves selectable text & vectors cleanly',
                  },
                  {
                    id: 'low',
                    title: 'High Quality',
                    desc: '180 DPI · 86% JPEG (best for print/scans)',
                  },
                  {
                    id: 'medium',
                    title: 'Balanced',
                    desc: '130 DPI · 70% JPEG (recommended)',
                  },
                  {
                    id: 'high',
                    title: 'Maximum Shrink',
                    desc: '92 DPI · 50% JPEG (smallest email size)',
                  },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`option-card ${preset === opt.id ? 'selected' : ''}`}
                    onClick={() => setPreset(opt.id as CompressionPreset)}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{opt.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 18,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={grayscale}
                onChange={(e) => setGrayscale(e.target.checked)}
              />
              <span>Convert pages to grayscale for additional size reduction</span>
            </label>

            {progress && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, marginBottom: 6, color: 'var(--text-muted)' }}>
                  Compressing page {progress.current} of {progress.total}...
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
              onClick={handleCompress}
            >
              <Minimize2 size={16} />
              <span>{processing ? 'Compressing...' : 'Compress & Save PDF'}</span>
            </button>
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
