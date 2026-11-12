import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { SuccessBanner } from '../../components/SuccessBanner';
import {
  formatBytes,
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import { protectPdf, unlockPdf } from '../../utils/pdfTools';

interface ProtectUnlockToolProps {
  mode: 'protect' | 'unlock';
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array; password?: string }) => void;
}

export const ProtectUnlockTool: React.FC<ProtectUnlockToolProps> = ({
  mode,
  onBack,
  onOpenInEditor,
}) => {
  const [file, setFile] = useState<SelectedBinaryFile | null>(null);
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [printing, setPrinting] = useState<'highResolution' | 'lowResolution' | 'none'>(
    'highResolution',
  );
  const [modifying, setModifying] = useState(false);
  const [copying, setCopying] = useState(false);
  const [annotating, setAnnotating] = useState(true);
  const [fillingForms, setFillingForms] = useState(true);
  const [documentAssembly, setDocumentAssembly] = useState(false);

  const [unlockPassword, setUnlockPassword] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<{
    fileName: string;
    filePath?: string | null;
    bytes: Uint8Array;
    passwordUsed?: string;
  } | null>(null);

  const handleProtect = async () => {
    if (!file) return;
    if (!userPassword && !ownerPassword) {
      setError('Enter an Open Password or Permissions Password.');
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const out = await protectPdf({
        bytes: file.bytes,
        userPassword,
        ownerPassword: ownerPassword || userPassword,
        printing,
        modifying,
        copying,
        annotating,
        fillingForms,
        contentAccessibility: true,
        documentAssembly,
      });

      const defaultName = `${stripExtension(file.name)}_protected.pdf`;
      const res = await saveBinaryFile({ defaultName, data: out });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: out,
          passwordUsed: userPassword || ownerPassword,
        });
      }
    } catch (err) {
      setError(`Encryption failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleUnlock = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const out = await unlockPdf({
        bytes: file.bytes,
        password: unlockPassword,
      });

      const defaultName = `${stripExtension(file.name)}_unlocked.pdf`;
      const res = await saveBinaryFile({ defaultName, data: out });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: out,
        });
      }
    } catch (err) {
      setError(`Could not unlock PDF (check password): ${String((err as Error)?.message || err)}`);
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
            <div
              className="tool-icon-box"
              style={{ background: mode === 'protect' ? '#e11d48' : '#be123c' }}
            >
              {mode === 'protect' ? <Lock size={20} /> : <Unlock size={20} />}
            </div>
            <div>
              <h1>{mode === 'protect' ? 'Protect PDF' : 'Unlock PDF'}</h1>
              <p>
                {mode === 'protect'
                  ? 'Encrypt PDF documents with AES-256 passwords and granular permissions.'
                  : 'Remove password protection and editing restrictions with the valid password.'}
              </p>
            </div>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {outputInfo && (
          <SuccessBanner
            title={mode === 'protect' ? 'PDF encrypted with AES-256!' : 'PDF unlocked!'}
            outputFileName={outputInfo.fileName}
            outputPath={outputInfo.filePath}
            outputSize={outputInfo.bytes.byteLength}
            onOpenInEditor={() =>
              onOpenInEditor({
                name: outputInfo.fileName,
                path: outputInfo.filePath || undefined,
                size: outputInfo.bytes.byteLength,
                bytes: outputInfo.bytes,
                password: outputInfo.passwordUsed,
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
              mode === 'protect'
                ? 'Drop a PDF file to password-protect'
                : 'Drop a password-protected PDF file to unlock'
            }
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => {
              if (fs[0]) {
                setFile(fs[0]);
                setError(null);
                setOutputInfo(null);
              }
            }}
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

            {mode === 'protect' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Password to Open PDF (User Password)</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPw ? 'text' : 'password'}
                        className="input"
                        value={userPassword}
                        onChange={(e) => setUserPassword(e.target.value)}
                        placeholder="Required to open file"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Permissions Password (Owner Password, optional)
                    </label>
                    <input
                      type={showPw ? 'text' : 'password'}
                      className="input"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      placeholder="Defaults to open password"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginBottom: 16 }}
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span>{showPw ? 'Hide Passwords' : 'Show Passwords'}</span>
                </button>

                <div className="form-group">
                  <label className="form-label">Printing Permission</label>
                  <select
                    className="select"
                    value={printing}
                    onChange={(e) =>
                      setPrinting(e.target.value as 'highResolution' | 'lowResolution' | 'none')
                    }
                  >
                    <option value="highResolution">Allow High-Resolution Printing</option>
                    <option value="lowResolution">Allow Low-Resolution Printing Only</option>
                    <option value="none">Disable Printing</option>
                  </select>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  {[
                    { label: 'Allow Modifying Content', val: modifying, set: setModifying },
                    { label: 'Allow Copying Text & Images', val: copying, set: setCopying },
                    { label: 'Allow Adding Comments', val: annotating, set: setAnnotating },
                    { label: 'Allow Filling Form Fields', val: fillingForms, set: setFillingForms },
                    { label: 'Allow Page Reordering', val: documentAssembly, set: setDocumentAssembly },
                  ].map((perm) => (
                    <label
                      key={perm.label}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={perm.val}
                        onChange={(e) => perm.set(e.target.checked)}
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>

                <button
                  className="btn btn-primary btn-lg"
                  disabled={processing}
                  onClick={handleProtect}
                >
                  <Lock size={16} />
                  <span>{processing ? 'Encrypting PDF...' : 'Encrypt & Save PDF'}</span>
                </button>
              </>
            ) : (
              <>
                <div className="form-group" style={{ maxWidth: 420 }}>
                  <label className="form-label">Current PDF Password</label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    placeholder="Enter user or owner password..."
                  />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn btn-primary btn-lg"
                    disabled={processing}
                    onClick={handleUnlock}
                  >
                    <Unlock size={16} />
                    <span>{processing ? 'Unlocking...' : 'Unlock & Save PDF'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
