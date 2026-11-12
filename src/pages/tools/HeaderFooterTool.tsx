import React, { useState } from 'react';
import { ArrowLeft, Hash } from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { SuccessBanner } from '../../components/SuccessBanner';
import type { FontFamilyChoice } from '../../types/pdf';
import {
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import { PdfPasswordRequiredError, getPdfMetadataSummary } from '../../utils/pdfRenderer';
import { headerFooterPdf } from '../../utils/pdfTools';

interface HeaderFooterToolProps {
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

export const HeaderFooterTool: React.FC<HeaderFooterToolProps> = ({
  onBack,
  onOpenInEditor,
}) => {
  const [file, setFile] = useState<{
    name: string;
    bytes: Uint8Array;
    password?: string;
    pageCount: number;
  } | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const [headerLeft, setHeaderLeft] = useState('');
  const [headerCenter, setHeaderCenter] = useState('');
  const [headerRight, setHeaderRight] = useState('');
  const [footerLeft, setFooterLeft] = useState('{filename}');
  const [footerCenter, setFooterCenter] = useState('Page {page} of {total}');
  const [footerRight, setFooterRight] = useState('{date}');

  const [fontFamily, setFontFamily] = useState<FontFamilyChoice>('Helvetica');
  const [fontSize, setFontSize] = useState(10);
  const [color, setColor] = useState('#334155');
  const [marginX, setMarginX] = useState(32);
  const [marginY, setMarginY] = useState(22);
  const [startNumber, setStartNumber] = useState(1);
  const [skipFirstPage, setSkipFirstPage] = useState(false);

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

  const applyPreset = (preset: 'pageOfTotal' | 'bottomRight' | 'roman' | 'batesHeader') => {
    if (preset === 'pageOfTotal') {
      setHeaderLeft('');
      setHeaderCenter('');
      setHeaderRight('');
      setFooterLeft('');
      setFooterCenter('Page {page} of {total}');
      setFooterRight('');
    } else if (preset === 'bottomRight') {
      setHeaderLeft('');
      setHeaderCenter('');
      setHeaderRight('');
      setFooterLeft('');
      setFooterCenter('');
      setFooterRight('{page} / {total}');
    } else if (preset === 'roman') {
      setHeaderLeft('');
      setHeaderCenter('');
      setHeaderRight('');
      setFooterLeft('');
      setFooterCenter('- {roman} -');
      setFooterRight('');
    } else {
      setHeaderLeft('{filename}');
      setHeaderCenter('');
      setHeaderRight('{date}');
      setFooterLeft('');
      setFooterCenter('Page {page} of {total}');
      setFooterRight('');
    }
  };

  const handleApply = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const out = await headerFooterPdf({
        bytes: file.bytes,
        fileName: file.name,
        password: file.password,
        headerLeft,
        headerCenter,
        headerRight,
        footerLeft,
        footerCenter,
        footerRight,
        fontFamily,
        fontSize,
        color,
        marginX,
        marginY,
        startNumber,
        skipFirstPage,
      });
      const defaultName = `${stripExtension(file.name)}_numbered.pdf`;
      const res = await saveBinaryFile({ defaultName, data: out });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: out,
        });
      }
    } catch (err) {
      setError(`Header & Footer failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
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
            <div className="tool-icon-box" style={{ background: '#10b981' }}>
              <Hash size={20} />
            </div>
            <div>
              <h1>Header & Footer / Page Numbers</h1>
              <p>Insert dynamic page numbers, dates, and titles across your PDF.</p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {outputInfo && (
          <SuccessBanner
            title="Headers & footers applied!"
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
            title="Drop a PDF file to add headers, footers, or page numbers"
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => fs[0] && loadFile(fs[0])}
          />
        ) : (
          <div className="panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <strong>{file.name}</strong> ({file.pageCount} pages)
              </div>
              <button className="btn btn-sm" onClick={() => setFile(null)}>
                Change File
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <button className="btn btn-sm" onClick={() => applyPreset('pageOfTotal')}>
                Preset: Page 1 of N (Center)
              </button>
              <button className="btn btn-sm" onClick={() => applyPreset('bottomRight')}>
                Preset: 1 / N (Bottom Right)
              </button>
              <button className="btn btn-sm" onClick={() => applyPreset('roman')}>
                Preset: Roman (- i -)
              </button>
              <button className="btn btn-sm" onClick={() => applyPreset('batesHeader')}>
                Preset: Filename + Date + Page
              </button>
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                fontSize: 12.5,
                marginBottom: 16,
              }}
            >
              Supported tokens: <code>{'{page}'}</code>, <code>{'{total}'}</code>,{' '}
              <code>{'{roman}'}</code>, <code>{'{date}'}</code>, <code>{'{filename}'}</code>
            </div>

            <div className="form-group">
              <label className="form-label">Header Zones (Left / Center / Right)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <input
                  className="input"
                  placeholder="Header Left"
                  value={headerLeft}
                  onChange={(e) => setHeaderLeft(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Header Center"
                  value={headerCenter}
                  onChange={(e) => setHeaderCenter(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Header Right"
                  value={headerRight}
                  onChange={(e) => setHeaderRight(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Footer Zones (Left / Center / Right)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <input
                  className="input"
                  placeholder="Footer Left"
                  value={footerLeft}
                  onChange={(e) => setFooterLeft(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Footer Center"
                  value={footerCenter}
                  onChange={(e) => setFooterCenter(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Footer Right"
                  value={footerRight}
                  onChange={(e) => setFooterRight(e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Font</label>
                <select
                  className="select"
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value as FontFamilyChoice)}
                >
                  <option value="Helvetica">Helvetica</option>
                  <option value="Times">Times Roman</option>
                  <option value="Courier">Courier</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Font Size (pt)</label>
                <input
                  type="number"
                  className="input"
                  min={6}
                  max={36}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value) || 10)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Color</label>
                <input
                  type="color"
                  className="input"
                  style={{ padding: 2, height: 36 }}
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Start Number</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  value={startNumber}
                  onChange={(e) => setStartNumber(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Horizontal Margin</label>
                <input
                  type="number"
                  className="input"
                  min={8}
                  max={120}
                  value={marginX}
                  onChange={(e) => setMarginX(Number(e.target.value) || 32)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Vertical Margin</label>
                <input
                  type="number"
                  className="input"
                  min={8}
                  max={120}
                  value={marginY}
                  onChange={(e) => setMarginY(Number(e.target.value) || 22)}
                />
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
                checked={skipFirstPage}
                onChange={(e) => setSkipFirstPage(e.target.checked)}
              />
              <span>Skip page 1 (useful for cover / title pages)</span>
            </label>

            <div>
              <button
                className="btn btn-primary btn-lg"
                disabled={processing}
                onClick={handleApply}
              >
                <Hash size={16} />
                <span>{processing ? 'Applying...' : 'Apply & Save PDF'}</span>
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
