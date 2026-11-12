import React, { useState, useRef, useEffect } from 'react';
import {
  Clock,
  FileText,
  FolderOpen,
  Grid,
  Moon,
  PenTool,
  Printer,
  Save,
  Sun,
  Trash2,
} from 'lucide-react';
import type { RecentFileRecord, ToolId } from '../types/pdf';
import { formatBytes } from '../utils/fileBridge';

interface TopBarProps {
  activeTool: ToolId;
  onNavigate: (tool: ToolId) => void;
  activeFileName?: string;
  activePageCount?: number;
  isDirty?: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenPdfForEditor: () => void;
  recentFiles: RecentFileRecord[];
  onOpenRecentFile: (record: RecentFileRecord) => void;
  onClearRecentFiles: () => void;
  onEditorSave?: () => void;
  onEditorSaveAs?: () => void;
  onEditorPrint?: () => void;
  isSaving?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTool,
  onNavigate,
  activeFileName,
  activePageCount,
  isDirty,
  darkMode,
  onToggleDarkMode,
  onOpenPdfForEditor,
  recentFiles,
  onOpenRecentFile,
  onClearRecentFiles,
  onEditorSave,
  onEditorSaveAs,
  onEditorPrint,
  isSaving,
}) => {
  const [recentOpen, setRecentOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setRecentOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="brand-btn"
          onClick={() => onNavigate('home')}
          title="JadePDF Editor — All Tools"
        >
          <span className="brand-logo">J</span>
          <span>JadePDF</span>
        </button>

        <button
          className={`nav-pill ${activeTool === 'home' ? 'active' : ''}`}
          onClick={() => onNavigate('home')}
        >
          <Grid size={15} />
          <span>All Tools</span>
        </button>

        <button
          className={`nav-pill ${activeTool === 'editor' ? 'active' : ''}`}
          onClick={() => onNavigate('editor')}
        >
          <PenTool size={15} />
          <span>PDF Editor</span>
        </button>

        <button className="nav-pill" onClick={onOpenPdfForEditor}>
          <FolderOpen size={15} />
          <span>Open PDF</span>
        </button>

        <div className="dropdown-menu" ref={dropdownRef}>
          <button
            className="nav-pill"
            onClick={() => setRecentOpen((prev) => !prev)}
            title="Recent PDF files"
          >
            <Clock size={15} />
            <span>Recent</span>
          </button>

          {recentOpen && (
            <div className="dropdown-panel" style={{ minWidth: 290 }}>
              {recentFiles.length === 0 ? (
                <div style={{ padding: '12px 10px', color: 'var(--text-muted)', fontSize: 12.5 }}>
                  No recent files yet. Open a PDF to list it here.
                </div>
              ) : (
                <>
                  {recentFiles.map((rf) => (
                    <button
                      key={rf.path}
                      className="dropdown-item"
                      onClick={() => {
                        setRecentOpen(false);
                        onOpenRecentFile(rf);
                      }}
                    >
                      <FileText size={15} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {rf.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {formatBytes(rf.size)}
                        </div>
                      </div>
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
                    <button
                      className="dropdown-item"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => {
                        setRecentOpen(false);
                        onClearRecentFiles();
                      }}
                    >
                      <Trash2 size={14} />
                      <span>Clear Recent List</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="topbar-center">
        {activeTool === 'editor' && activeFileName && (
          <div className="doc-badge" title={activeFileName}>
            {isDirty && <span className="dirty-dot" title="Unsaved changes" />}
            <span className="doc-badge-name">{activeFileName}</span>
            {typeof activePageCount === 'number' && (
              <span className="doc-badge-pages">{activePageCount} pages</span>
            )}
          </div>
        )}
      </div>

      <div className="topbar-right">
        {activeTool === 'editor' && activeFileName && (
          <>
            <button
              className="btn btn-sm"
              onClick={onEditorPrint}
              disabled={isSaving}
              title="Print PDF (Ctrl+P)"
            >
              <Printer size={14} />
              <span>Print</span>
            </button>
            <button
              className="btn btn-sm"
              onClick={onEditorSaveAs}
              disabled={isSaving}
              title="Save As New PDF (Ctrl+Shift+S)"
            >
              <span>Save As...</span>
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={onEditorSave}
              disabled={isSaving}
              title="Apply changes and save PDF (Ctrl+S)"
            >
              <Save size={14} />
              <span>{isSaving ? 'Saving...' : 'Apply Changes'}</span>
            </button>
          </>
        )}

        <button
          className="icon-btn"
          onClick={onToggleDarkMode}
          title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {darkMode ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
};
