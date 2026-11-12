import React, { useState } from 'react';
import { Lock, X } from 'lucide-react';

interface PasswordModalProps {
  fileName: string;
  errorMessage?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export const PasswordModal: React.FC<PasswordModalProps> = ({
  fileName,
  errorMessage,
  onSubmit,
  onCancel,
}) => {
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(password);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={18} style={{ color: 'var(--brand)' }} />
            <h3>Password Required</h3>
          </div>
          <button className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 13 }}>
              <strong>{fileName}</strong> is encrypted. Enter its password to open it.
            </p>
            {errorMessage && (
              <div className="error-banner" style={{ marginBottom: 12, padding: '8px 12px' }}>
                {errorMessage}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Document Password</label>
              <input
                type="password"
                className="input"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter PDF password..."
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!password}>
              Unlock & Open
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
