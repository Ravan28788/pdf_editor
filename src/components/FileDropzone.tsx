import React, { useState } from 'react';
import { FilePlus2, FolderOpen, Upload } from 'lucide-react';
import { pickFiles, readDroppedFiles, type SelectedBinaryFile } from '../utils/fileBridge';

interface FileDropzoneProps {
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  accept?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
  compact?: boolean;
  onFilesSelected: (files: SelectedBinaryFile[]) => void;
  onCreateBlankPdf?: () => void;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  title = 'Drop PDF file here',
  subtitle = 'or click below to choose from your computer (works 100% offline)',
  buttonLabel = 'Choose PDF File',
  accept = '.pdf,application/pdf',
  filters = [{ name: 'PDF Documents', extensions: ['pdf'] }],
  multiple = false,
  compact = false,
  onFilesSelected,
  onCreateBlankPdf,
}) => {
  const [dragOver, setDragOver] = useState(false);

  const handleBrowse = async () => {
    const files = await pickFiles({
      title: buttonLabel,
      accept,
      filters,
      multiple,
    });
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!e.dataTransfer?.files?.length) return;
    const files = await readDroppedFiles(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesSelected(multiple ? files : [files[0]]);
    }
  };

  return (
    <div
      className={`dropzone ${compact ? 'compact' : ''} ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={handleDrop}
      onClick={handleBrowse}
    >
      <div className="dropzone-icon">
        <Upload size={compact ? 22 : 26} />
      </div>
      <div style={{ fontSize: compact ? 15 : 17, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>{subtitle}</div>

      <div
        style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="btn btn-primary" onClick={handleBrowse}>
          <FolderOpen size={15} />
          <span>{buttonLabel}</span>
        </button>

        {onCreateBlankPdf && (
          <button type="button" className="btn" onClick={onCreateBlankPdf}>
            <FilePlus2 size={15} />
            <span>Create Blank PDF</span>
          </button>
        )}
      </div>
    </div>
  );
};
