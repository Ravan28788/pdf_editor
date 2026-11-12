import React, { useMemo, useState } from 'react';
import {
  Combine,
  Crop,
  Eraser,
  FileCheck2,
  FileImage,
  FileOutput,
  FilePlus2,
  FileText,
  Hash,
  Image as ImageIcon,
  Layers,
  Lock,
  Minimize2,
  PenTool,
  RotateCw,
  Scissors,
  Search,
  SlidersHorizontal,
  Stamp,
  Trash2,
  Unlock,
} from 'lucide-react';
import { TOOLS_CATALOG } from '../data/tools';
import type { RecentFileRecord, ToolCategory, ToolId } from '../types/pdf';
import { FileDropzone } from '../components/FileDropzone';
import { formatBytes, type SelectedBinaryFile } from '../utils/fileBridge';

interface ToolsHubProps {
  onSelectTool: (tool: ToolId) => void;
  onOpenFileInEditor: (file: SelectedBinaryFile) => void;
  onCreateBlankPdf: () => void;
  recentFiles: RecentFileRecord[];
  onOpenRecentFile: (record: RecentFileRecord) => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | ToolCategory; label: string }> = [
  { id: 'all', label: 'All Tools' },
  { id: 'edit', label: 'Edit & Sign' },
  { id: 'organize', label: 'Organize Pages' },
  { id: 'optimize', label: 'Compress & Convert' },
  { id: 'security', label: 'Protect & Metadata' },
];

function renderToolIcon(id: ToolId) {
  const props = { size: 20 };
  switch (id) {
    case 'editor':
      return <PenTool {...props} />;
    case 'merge':
      return <Combine {...props} />;
    case 'split':
      return <Scissors {...props} />;
    case 'compress':
      return <Minimize2 {...props} />;
    case 'organize':
      return <Layers {...props} />;
    case 'delete':
      return <Trash2 {...props} />;
    case 'extract':
      return <FileOutput {...props} />;
    case 'rotate':
      return <RotateCw {...props} />;
    case 'watermark':
      return <Stamp {...props} />;
    case 'headerFooter':
      return <Hash {...props} />;
    case 'crop':
      return <Crop {...props} />;
    case 'imgToPdf':
      return <ImageIcon {...props} />;
    case 'pdfToImg':
      return <FileImage {...props} />;
    case 'protect':
      return <Lock {...props} />;
    case 'unlock':
      return <Unlock {...props} />;
    case 'flatten':
      return <FileCheck2 {...props} />;
    case 'metadata':
      return <SlidersHorizontal {...props} />;
    default:
      return <Eraser {...props} />;
  }
}

export const ToolsHub: React.FC<ToolsHubProps> = ({
  onSelectTool,
  onOpenFileInEditor,
  onCreateBlankPdf,
  recentFiles,
  onOpenRecentFile,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | ToolCategory>('all');

  const filteredTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TOOLS_CATALOG.filter((tool) => {
      if (category !== 'all' && tool.category !== category) return false;
      if (!q) return true;
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q)
      );
    });
  }, [search, category]);

  return (
    <div className="main-scroll">
      <div className="container-xl">
        <section className="hero-banner">
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 99,
                background: 'var(--brand-soft)',
                color: 'var(--brand)',
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 10,
              }}
            >
              100% Offline Windows Desktop PDF Suite
            </div>
            <h1 className="hero-title">We help with your PDF tasks</h1>
            <p className="hero-sub">
              Edit existing PDF text inline, add signatures and fillable forms, merge, split,
              compress, watermark, crop, convert images, and encrypt documents directly on your
              computer — fast and private.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg" onClick={() => onSelectTool('editor')}>
                <PenTool size={16} />
                <span>Launch PDF Editor</span>
              </button>
              <button className="btn btn-lg" onClick={() => onSelectTool('merge')}>
                <Combine size={16} />
                <span>Merge PDFs</span>
              </button>
              <button className="btn btn-lg" onClick={onCreateBlankPdf}>
                <FilePlus2 size={16} />
                <span>New Blank PDF</span>
              </button>
            </div>
          </div>

          <FileDropzone
            compact
            title="Drop a PDF to start editing"
            subtitle="Opens straight into the interactive PDF Editor"
            buttonLabel="Open PDF in Editor"
            onFilesSelected={(files) => {
              if (files[0]) onOpenFileInEditor(files[0]);
            }}
          />
        </section>

        {recentFiles.length > 0 && (
          <section style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                marginBottom: 10,
              }}
            >
              Recent Files
            </div>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
              {recentFiles.map((rf) => (
                <button
                  key={rf.path}
                  className="panel-card"
                  onClick={() => onOpenRecentFile(rf)}
                  style={{
                    minWidth: 210,
                    maxWidth: 250,
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <FileText size={18} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {rf.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {formatBytes(rf.size)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="search-filter-bar">
          <div className="category-tabs">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`cat-tab ${category === tab.id ? 'active' : ''}`}
                onClick={() => setCategory(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="search-box">
            <Search size={15} className="search-box-icon" />
            <input
              type="text"
              placeholder="Search tools (e.g. merge, edit, watermark, protect)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filteredTools.length === 0 ? (
          <div className="panel-card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>
              No tools match "{search}". Try clearing your filter.
            </p>
          </div>
        ) : (
          <div className="tools-grid">
            {filteredTools.map((tool) => (
              <button
                key={tool.id}
                className="tool-card"
                onClick={() => onSelectTool(tool.id)}
              >
                <div className="tool-card-top">
                  <div className="tool-icon-box" style={{ background: tool.accent }}>
                    {renderToolIcon(tool.id)}
                  </div>
                  {tool.badge && <span className="tool-badge">{tool.badge}</span>}
                </div>
                <h3 className="tool-card-title">{tool.name}</h3>
                <p className="tool-card-desc">{tool.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
