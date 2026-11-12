import React, { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  FileOutput,
  FilePlus2,
  Layers,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { FileDropzone } from '../../components/FileDropzone';
import { PasswordModal } from '../../components/PasswordModal';
import { PdfThumbnail } from '../../components/PdfThumbnail';
import { SuccessBanner } from '../../components/SuccessBanner';
import {
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from '../../utils/fileBridge';
import {
  PdfPasswordRequiredError,
  getPdfMetadataSummary,
  loadPdfJsDocument,
} from '../../utils/pdfRenderer';
import { organizePdf } from '../../utils/pdfTools';

interface OrganizePagesToolProps {
  mode: 'organize' | 'delete' | 'extract' | 'rotate';
  onBack: () => void;
  onOpenInEditor: (file: { name: string; path?: string; size: number; bytes: Uint8Array }) => void;
}

interface PageTile {
  id: string;
  sourcePageIndex: number; // -1 for blank
  rotationDelta: number;
  selected: boolean;
}

export const OrganizePagesTool: React.FC<OrganizePagesToolProps> = ({
  mode,
  onBack,
  onOpenInEditor,
}) => {
  const [file, setFile] = useState<{
    name: string;
    bytes: Uint8Array;
    password?: string;
    proxy: PDFDocumentProxy;
  } | null>(null);
  const [tiles, setTiles] = useState<PageTile[]>([]);
  const [pendingEncrypted, setPendingEncrypted] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<{
    fileName: string;
    filePath?: string | null;
    bytes: Uint8Array;
  } | null>(null);

  useEffect(() => {
    return () => {
      file?.proxy.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = {
    organize: {
      title: 'Organize Pages',
      desc: 'Reorder, rotate, duplicate, delete, or insert blank pages visually.',
      accent: '#4f46e5',
      icon: <Layers size={20} />,
    },
    delete: {
      title: 'Delete Pages',
      desc: 'Click the pages you want to remove, then save the cleaned PDF.',
      accent: '#dc2626',
      icon: <Trash2 size={20} />,
    },
    extract: {
      title: 'Extract Pages',
      desc: 'Select specific pages to pull out into a standalone new PDF.',
      accent: '#0284c7',
      icon: <FileOutput size={20} />,
    },
    rotate: {
      title: 'Rotate PDF',
      desc: 'Rotate individual pages or all pages 90°, 180°, or 270° permanently.',
      accent: '#7c3aed',
      icon: <RotateCw size={20} />,
    },
  }[mode];

  const loadFile = async (selected: SelectedBinaryFile, password?: string) => {
    setError(null);
    setOutputInfo(null);
    try {
      const summary = await getPdfMetadataSummary(selected.bytes, password);
      const proxy = await loadPdfJsDocument(selected.bytes, password);
      file?.proxy.destroy().catch(() => {});
      setFile({
        name: selected.name,
        bytes: selected.bytes,
        password,
        proxy,
      });
      setTiles(
        Array.from({ length: summary.pageCount }, (_, idx) => ({
          id: `tile-${idx}-${Date.now()}`,
          sourcePageIndex: idx,
          rotationDelta: 0,
          selected: false,
        })),
      );
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

  const selectedCount = tiles.filter((t) => t.selected).length;

  const toggleSelect = (id: string) => {
    setTiles((prev) => prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)));
  };

  const selectPreset = (kind: 'all' | 'none' | 'odd' | 'even') => {
    setTiles((prev) =>
      prev.map((t, idx) => ({
        ...t,
        selected:
          kind === 'all'
            ? true
            : kind === 'none'
              ? false
              : kind === 'odd'
                ? (idx + 1) % 2 !== 0
                : (idx + 1) % 2 === 0,
      })),
    );
  };

  const rotateTargetTiles = (delta: number, singleId?: string) => {
    setTiles((prev) =>
      prev.map((t) => {
        const should = singleId ? t.id === singleId : selectedCount === 0 || t.selected;
        if (!should) return t;
        return { ...t, rotationDelta: ((t.rotationDelta + delta) % 360 + 360) % 360 };
      }),
    );
  };

  const moveTile = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= tiles.length) return;
    setTiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const duplicateTile = (idx: number) => {
    setTiles((prev) => {
      const src = prev[idx];
      const next = [...prev];
      next.splice(idx + 1, 0, {
        ...src,
        id: `dup-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        selected: false,
      });
      return next;
    });
  };

  const deleteSelectedOrSingle = (singleId?: string) => {
    setTiles((prev) => {
      const remaining = prev.filter((t) => (singleId ? t.id !== singleId : !t.selected));
      return remaining.length > 0 ? remaining : prev;
    });
  };

  const addBlankPage = () => {
    setTiles((prev) => [
      ...prev,
      {
        id: `blank-${Date.now()}`,
        sourcePageIndex: -1,
        rotationDelta: 0,
        selected: false,
      },
    ]);
  };

  const handleApply = async () => {
    if (!file || tiles.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      let targetTiles = tiles;
      if (mode === 'delete' && selectedCount > 0) {
        const kept = tiles.filter((t) => !t.selected);
        if (kept.length === 0) {
          setError('Cannot delete every page. Keep at least 1 page.');
          setProcessing(false);
          return;
        }
        targetTiles = kept;
      } else if (mode === 'extract') {
        const picked = tiles.filter((t) => t.selected);
        if (picked.length === 0) {
          setError('Select at least one page to extract.');
          setProcessing(false);
          return;
        }
        targetTiles = picked;
      }

      const outBytes = await organizePdf({
        bytes: file.bytes,
        password: file.password,
        pages: targetTiles.map((t) => ({
          sourcePageIndex: t.sourcePageIndex,
          rotationDelta: t.rotationDelta,
        })),
      });

      const suffix =
        mode === 'delete'
          ? 'deleted'
          : mode === 'extract'
            ? 'extracted'
            : mode === 'rotate'
              ? 'rotated'
              : 'organized';
      const defaultName = `${stripExtension(file.name)}_${suffix}.pdf`;
      const res = await saveBinaryFile({ defaultName, data: outBytes });
      if (res.saved) {
        setOutputInfo({
          fileName: defaultName,
          filePath: res.filePath,
          bytes: outBytes,
        });
      }
    } catch (err) {
      setError(`Operation failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="main-scroll">
      <div className="container-xl">
        <div className="tool-page-header">
          <div className="tool-page-title">
            <button className="btn btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> All Tools
            </button>
            <div className="tool-icon-box" style={{ background: meta.accent }}>
              {meta.icon}
            </div>
            <div>
              <h1>{meta.title}</h1>
              <p>{meta.desc}</p>
            </div>
          </div>

          {file && (
            <button className="btn btn-primary btn-lg" disabled={processing} onClick={handleApply}>
              <span>{processing ? 'Processing...' : `${meta.title} & Save PDF`}</span>
            </button>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}
        {outputInfo && (
          <SuccessBanner
            title={`${meta.title} completed!`}
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
              setTiles([]);
            }}
          />
        )}

        {!file ? (
          <FileDropzone
            title={`Drop a PDF file for ${meta.title}`}
            buttonLabel="Choose PDF File"
            onFilesSelected={(fs) => fs[0] && loadFile(fs[0])}
          />
        ) : (
          <div className="panel-card">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                paddingBottom: 14,
                marginBottom: 16,
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => selectPreset('all')}>
                  Select All
                </button>
                <button className="btn btn-sm" onClick={() => selectPreset('odd')}>
                  Odd Pages
                </button>
                <button className="btn btn-sm" onClick={() => selectPreset('even')}>
                  Even Pages
                </button>
                <button className="btn btn-sm" onClick={() => selectPreset('none')}>
                  Clear ({selectedCount})
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => rotateTargetTiles(-90)}>
                  <RotateCcw size={14} /> Rotate Left
                </button>
                <button className="btn btn-sm" onClick={() => rotateTargetTiles(90)}>
                  <RotateCw size={14} /> Rotate Right
                </button>
                {mode === 'organize' && (
                  <button className="btn btn-sm" onClick={addBlankPage}>
                    <FilePlus2 size={14} /> Add Blank Page
                  </button>
                )}
                {mode === 'organize' && selectedCount > 0 && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => deleteSelectedOrSingle()}
                  >
                    <Trash2 size={14} /> Remove Selected
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => setFile(null)}>
                  Change File
                </button>
              </div>
            </div>

            <div className="thumb-grid">
              {tiles.map((tile, idx) => (
                <div
                  key={tile.id}
                  className={`thumb-card ${tile.selected ? 'selected' : ''}`}
                  onClick={() => toggleSelect(tile.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="thumb-preview-box">
                    <PdfThumbnail
                      pdfDoc={file.proxy}
                      pageNumber={tile.sourcePageIndex + 1}
                      rotationDelta={tile.rotationDelta}
                      width={126}
                      maxHeight={164}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12,
                    }}
                  >
                    <strong>
                      {tile.sourcePageIndex < 0 ? 'Blank' : `Page ${tile.sourcePageIndex + 1}`}
                    </strong>
                    {tile.rotationDelta !== 0 && (
                      <span style={{ color: 'var(--brand)', fontWeight: 700 }}>
                        {tile.rotationDelta}°
                      </span>
                    )}
                  </div>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button
                        className="icon-btn"
                        style={{ width: 24, height: 24 }}
                        disabled={idx === 0}
                        onClick={() => moveTile(idx, -1)}
                        title="Move Backward"
                      >
                        <ArrowLeft size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 24, height: 24 }}
                        disabled={idx === tiles.length - 1}
                        onClick={() => moveTile(idx, 1)}
                        title="Move Forward"
                      >
                        <ArrowRight size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 24, height: 24 }}
                        onClick={() => rotateTargetTiles(90, tile.id)}
                        title="Rotate 90°"
                      >
                        <RotateCw size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 24, height: 24 }}
                        onClick={() => duplicateTile(idx)}
                        title="Duplicate"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                    <button
                      className="icon-btn"
                      style={{ width: 24, height: 24, color: 'var(--danger)' }}
                      disabled={tiles.length <= 1}
                      onClick={() => deleteSelectedOrSingle(tile.id)}
                      title="Delete Page"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
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
