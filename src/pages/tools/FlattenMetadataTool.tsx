import React, { useState } from 'react';
import { ArrowLeft, FileCheck2, SlidersHorizontal, Trash2 } from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { SuccessBanner } from '../../components/SuccessBanner';
import {
  formatBytes,
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import { PdfPasswordRequiredError } from '../../utils/pdfRenderer';
import {
  flattenPdf,
  readPdfMetadata,
  updatePdfMetadata,
  type PdfMetadataInfo,
} from '../../utils/pdfTools';

interface FlattenMetadataToolProps {
  mode: 'flatten' | 'metadata';
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

export const FlattenMetadataTool: React.FC<FlattenMetadataToolProps> = ({
  mode,
  onBack,
  onOpenInEditor,
}) => {
  const [file, setFile] = useState<{
    name: string;
    size: number;
    bytes: Uint8Array;
    password?: string;
  } | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const [flattenMode, setFlattenMode] = useState<'forms' | 'fullRaster'>('forms');
  const [dpi, setDpi] = useState(180);
  const [metadata, setMetadata] = useState<PdfMetadataInfo>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
    creator: '',
    producer: '',
  });

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
      if (mode === 'metadata') {
        const info = await readPdfMetadata(selected.bytes, password);
        setMetadata(info);
      } else {
        // Verify loadable (checks password if encrypted)
        await readPdfMetadata(selected.bytes, password);
      }
      setFile({
        name: selected.name,
        size: selected.size,
        bytes: selected.bytes,
        password,
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

  const handleApply = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const out =
        mode === 'flatten'
          ? await flattenPdf({
              bytes: file.bytes,
              password: file.password,
              mode: flattenMode,
              dpi,
              onProgress: (current, total) => setProgress({ current, total }),
            })
          : await updatePdfMetadata({
              bytes: file.bytes,
              password: file.password,
              metadata,
            });

      const suffix = mode === 'flatten' ? 'flattened' : 'metadata';
      const defaultName = `${stripExtension(file.name)}_${suffix}.pdf`;
      const res = await saveBinaryFile({ defaultName, data: out });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: out,
        });
      }
    } catch (err) {
      setError(`Operation failed: ${String((err as Error)?.message || err)}`);
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
            <div
              className="tool-icon-box"
              style={{ background: mode === 'flatten' ? '#475569' : '#334155' }}
            >
              {mode === 'flatten' ? <FileCheck2 size={20} /> : <SlidersHorizontal size={20} />}
            </div>
            <div>
              <h1>{mode === 'flatten' ? 'Flatten PDF' : 'Edit PDF Metadata'}</h1>
              <p>
                {mode === 'flatten'
                  ? 'Make filled form fields or full page annotations permanent and non-editable.'
                  : 'Inspect, update, or wipe hidden document properties like Author and Title.'}
              </p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {outputInfo && (
          <SuccessBanner
            title={mode === 'flatten' ? 'PDF flattened!' : 'PDF metadata updated!'}
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
            title={
              mode === 'flatten'
                ? 'Drop a PDF file to flatten forms & layers'
                : 'Drop a PDF file to view or edit metadata'
            }
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => fs[0] && loadFile(fs[0])}
          />
        ) : (
          <div className="panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <strong>{file.name}</strong> · {formatBytes(file.size)}
              </div>
              <button className="btn btn-sm" onClick={() => setFile(null)}>
                Change File
              </button>
            </div>

            {mode === 'flatten' ? (
              <>
                <div className="option-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
                  <button
                    type="button"
                    className={`option-card ${flattenMode === 'forms' ? 'selected' : ''}`}
                    onClick={() => setFlattenMode('forms')}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Flatten Form Fields</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Burns interactive AcroForm text, checkboxes & dropdowns into static PDF text.
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`option-card ${flattenMode === 'fullRaster' ? 'selected' : ''}`}
                    onClick={() => setFlattenMode('fullRaster')}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Flatten Entire Pages</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Converts every page & annotation into locked non-selectable image layers.
                    </div>
                  </button>
                </div>

                {flattenMode === 'fullRaster' && (
                  <div className="form-group" style={{ maxWidth: 260 }}>
                    <label className="form-label">Render DPI</label>
                    <select
                      className="select"
                      value={dpi}
                      onChange={(e) => setDpi(Number(e.target.value))}
                    >
                      <option value={150}>150 DPI (Standard)</option>
                      <option value={220}>220 DPI (Crisp)</option>
                      <option value={300}>300 DPI (Print Quality)</option>
                    </select>
                  </div>
                )}

                {progress && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12.5, marginBottom: 6, color: 'var(--text-muted)' }}>
                      Flattening page {progress.current} of {progress.total}...
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
              </>
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  {(
                    [
                      ['title', 'Document Title'],
                      ['author', 'Author'],
                      ['subject', 'Subject'],
                      ['keywords', 'Keywords (comma separated)'],
                      ['creator', 'Creator Application'],
                      ['producer', 'PDF Producer'],
                    ] as const
                  ).map(([key, label]) => (
                    <div className="form-group" key={key} style={{ marginBottom: 0 }}>
                      <label className="form-label">{label}</label>
                      <input
                        className="input"
                        value={metadata[key]}
                        onChange={(e) => setMetadata((m) => ({ ...m, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setMetadata({
                        title: '',
                        author: '',
                        subject: '',
                        keywords: '',
                        creator: '',
                        producer: '',
                      })
                    }
                  >
                    <Trash2 size={14} /> Clear All Metadata Fields
                  </button>
                </div>
              </>
            )}

            <button
              className="btn btn-primary btn-lg"
              disabled={processing}
              onClick={handleApply}
            >
              <span>
                {processing
                  ? 'Saving...'
                  : mode === 'flatten'
                    ? 'Flatten & Save PDF'
                    : 'Update Metadata & Save'}
              </span>
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
