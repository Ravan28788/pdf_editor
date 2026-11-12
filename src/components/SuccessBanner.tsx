import React from 'react';
import { CheckCircle2, FolderOpen, PenTool, RefreshCw } from 'lucide-react';
import { formatBytes } from '../utils/fileBridge';

interface SuccessBannerProps {
  title: string;
  outputFileName?: string;
  outputPath?: string | null;
  outputSize?: number;
  originalSize?: number;
  onOpenInEditor?: () => void;
  onReset?: () => void;
}

export const SuccessBanner: React.FC<SuccessBannerProps> = ({
  title,
  outputFileName,
  outputPath,
  outputSize,
  originalSize,
  onOpenInEditor,
  onReset,
}) => {
  const showReduction =
    typeof originalSize === 'number' &&
    typeof outputSize === 'number' &&
    originalSize > 0;
  const pctSaved = showReduction
    ? Math.round(((originalSize - outputSize) / originalSize) * 100)
    : 0;

  return (
    <div className="success-banner">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CheckCircle2 size={24} style={{ color: 'var(--brand)', flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
            {outputFileName && <span>{outputFileName}</span>}
            {typeof outputSize === 'number' && (
              <span> · {formatBytes(outputSize)}</span>
            )}
            {showReduction && pctSaved > 0 && (
              <strong style={{ color: 'var(--brand)', marginLeft: 6 }}>
                ({pctSaved}% smaller!)
              </strong>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {outputPath && window.electronAPI && (
          <button
            className="btn btn-sm"
            onClick={() => window.electronAPI?.showItemInFolder(outputPath)}
          >
            <FolderOpen size={14} />
            <span>Show in Folder</span>
          </button>
        )}

        {onOpenInEditor && (
          <button className="btn btn-primary btn-sm" onClick={onOpenInEditor}>
            <PenTool size={14} />
            <span>Open in PDF Editor</span>
          </button>
        )}

        {onReset && (
          <button className="btn btn-sm" onClick={onReset}>
            <RefreshCw size={14} />
            <span>New Task</span>
          </button>
        )}
      </div>
    </div>
  );
};
