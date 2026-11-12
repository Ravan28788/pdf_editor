import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bold,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Eraser,
  FilePlus2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  MessageSquare,
  Minus,
  MousePointer2,
  PanelLeft,
  PenTool,
  Redo2,
  RotateCcw,
  RotateCw,
  Search,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  EditorAnnotation,
  EditorPageState,
  EditorToolMode,
  FontFamilyChoice,
  FormFieldAnnotation,
  LinkAnnotation,
  NoteAnnotation,
  ShapeAnnotation,
  TextAnnotation,
} from '../types/pdf';
import {
  bytesToDataUrl,
  pickFiles,
  type SelectedBinaryFile,
} from '../utils/fileBridge';
import {
  extractDetectedTextBlocks,
  loadPdfJsDocument,
} from '../utils/pdfRenderer';
import { FileDropzone } from '../components/FileDropzone';
import { PdfThumbnail } from '../components/PdfThumbnail';
import { SignatureModal } from '../components/SignatureModal';
import {
  EditorPageCanvas,
  type ActiveToolDefaults,
} from '../components/editor/EditorPageCanvas';

export interface EditorSourceDoc {
  bytes: Uint8Array;
  password?: string;
  name: string;
}

interface PdfEditorViewProps {
  initialFile: {
    name: string;
    path?: string;
    size: number;
    bytes: Uint8Array;
    password?: string;
  } | null;
  onOpenSelectedFile: (file: SelectedBinaryFile) => void;
  onCreateBlankPdf: () => void;
  onDocumentStateChange: (info: {
    fileName?: string;
    pageCount?: number;
    isDirty: boolean;
  }) => void;
  registerExportApi: (api: {
    exportBytes: () => Promise<Uint8Array>;
    undo: () => void;
    redo: () => void;
    openFind: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    markSaved: () => void;
  } | null) => void;
  exportEditedPdf: (opts: {
    sourceDocs: Array<{ bytes: Uint8Array; password?: string }>;
    pages: EditorPageState[];
  }) => Promise<Uint8Array>;
}

interface SearchMatch {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fullText: string;
  fontSize: number;
  fontFamily: FontFamilyChoice;
  bold: boolean;
  italic: boolean;
  color: string;
  backgroundColor: string;
}

export const PdfEditorView: React.FC<PdfEditorViewProps> = ({
  initialFile,
  onOpenSelectedFile,
  onCreateBlankPdf,
  onDocumentStateChange,
  registerExportApi,
  exportEditedPdf,
}) => {
  const [sourceDocs, setSourceDocs] = useState<EditorSourceDoc[]>([]);
  const [pdfProxies, setPdfProxies] = useState<Array<PDFDocumentProxy | null>>([]);
  const [pages, setPages] = useState<EditorPageState[]>([]);
  const [undoStack, setUndoStack] = useState<EditorPageState[][]>([]);
  const [redoStack, setRedoStack] = useState<EditorPageState[][]>([]);
  const [isDirty, setIsDirty] = useState(false);

  const [toolMode, setToolMode] = useState<EditorToolMode>('select');
  const [showSidebar, setShowSidebar] = useState(true);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [zoom, setZoom] = useState(1.1);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showSigModal, setShowSigModal] = useState(false);
  const [showFormsMenu, setShowFormsMenu] = useState(false);
  const [showAnnotateMenu, setShowAnnotateMenu] = useState(false);

  const [showFindBar, setShowFindBar] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [searching, setSearching] = useState(false);

  const [defaults, setDefaults] = useState<ActiveToolDefaults>({
    fontFamily: 'Helvetica',
    fontSize: 14,
    bold: false,
    italic: false,
    textColor: '#111827',
    strokeColor: '#0ea96b',
    fillColor: 'transparent',
    strokeWidth: 2.5,
    opacity: 1,
    whiteoutColor: '#ffffff',
    highlightColor: '#fde047',
  });

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const formsMenuRef = useRef<HTMLDivElement>(null);
  const annotateMenuRef = useRef<HTMLDivElement>(null);

  // Close tool dropdowns on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (formsMenuRef.current && !formsMenuRef.current.contains(e.target as Node)) {
        setShowFormsMenu(false);
      }
      if (annotateMenuRef.current && !annotateMenuRef.current.contains(e.target as Node)) {
        setShowAnnotateMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Load initialFile whenever it changes
  useEffect(() => {
    let cancelled = false;
    const oldProxies = pdfProxies;

    if (!initialFile) {
      setSourceDocs([]);
      setPdfProxies([]);
      setPages([]);
      setUndoStack([]);
      setRedoStack([]);
      setIsDirty(false);
      return;
    }

    (async () => {
      try {
        const proxy = await loadPdfJsDocument(initialFile.bytes, initialFile.password);
        if (cancelled) {
          await proxy.destroy();
          return;
        }
        const initialPages: EditorPageState[] = [];
        for (let p = 1; p <= proxy.numPages; p += 1) {
          const pdfPage = await proxy.getPage(p);
          const vp = pdfPage.getViewport({ scale: 1 });
          initialPages.push({
            id: `pg-${Date.now()}-${p}`,
            sourceDocIndex: 0,
            sourcePageIndex: p - 1,
            rotation: 0,
            baseWidth: vp.width,
            baseHeight: vp.height,
            annotations: [],
          });
        }
        if (cancelled) {
          await proxy.destroy();
          return;
        }
        oldProxies.forEach((pr) => pr?.destroy().catch(() => {}));
        setSourceDocs([
          {
            bytes: initialFile.bytes,
            password: initialFile.password,
            name: initialFile.name,
          },
        ]);
        setPdfProxies([proxy]);
        setPages(initialPages);
        setUndoStack([]);
        setRedoStack([]);
        setSelectedAnnId(null);
        setEditingTextId(null);
        setActivePageIndex(0);
        setIsDirty(false);
      } catch (err) {
        console.error('Failed to initialize editor PDF:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // Notify TopBar about document metadata & dirty state
  useEffect(() => {
    onDocumentStateChange({
      fileName: initialFile?.name,
      pageCount: pages.length || undefined,
      isDirty,
    });
  }, [initialFile?.name, pages.length, isDirty, onDocumentStateChange]);

  const commitPagesChange = useCallback(
    (updater: (prev: EditorPageState[]) => EditorPageState[], recordHistory = true) => {
      setPages((prev) => {
        const next = updater(prev);
        if (recordHistory) {
          setUndoStack((u) => [...u.slice(-39), prev]);
          setRedoStack([]);
        }
        return next;
      });
      setIsDirty(true);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const previous = prevUndo[prevUndo.length - 1];
      setPages((curr) => {
        setRedoStack((r) => [...r, curr]);
        return previous;
      });
      setSelectedAnnId(null);
      setEditingTextId(null);
      setIsDirty(true);
      return prevUndo.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const next = prevRedo[prevRedo.length - 1];
      setPages((curr) => {
        setUndoStack((u) => [...u, curr]);
        return next;
      });
      setSelectedAnnId(null);
      setEditingTextId(null);
      setIsDirty(true);
      return prevRedo.slice(0, -1);
    });
  }, []);

  // Register export & menu handlers for TopBar / Electron Menu
  useEffect(() => {
    if (!sourceDocs.length) {
      registerExportApi(null);
      return;
    }
    registerExportApi({
      exportBytes: () =>
        exportEditedPdf({
          sourceDocs: sourceDocs.map((s) => ({ bytes: s.bytes, password: s.password })),
          pages,
        }),
      undo: handleUndo,
      redo: handleRedo,
      openFind: () => setShowFindBar(true),
      zoomIn: () => setZoom((z) => Math.min(2.6, Math.round((z + 0.15) * 100) / 100)),
      zoomOut: () => setZoom((z) => Math.max(0.45, Math.round((z - 0.15) * 100) / 100)),
      markSaved: () => setIsDirty(false),
    });
    return () => registerExportApi(null);
  }, [sourceDocs, pages, handleUndo, handleRedo, registerExportApi, exportEditedPdf]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowFindBar(true);
        return;
      }

      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnId) {
        e.preventDefault();
        commitPagesChange((prev) =>
          prev.map((pg) => ({
            ...pg,
            annotations: pg.annotations.filter((a) => a.id !== selectedAnnId),
          })),
        );
        setSelectedAnnId(null);
      } else if (e.key === 'Escape') {
        setToolMode('select');
        setSelectedAnnId(null);
        setEditingTextId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedAnnId, handleUndo, handleRedo, commitPagesChange]);

  const scrollToPage = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, idx));
    setActivePageIndex(clamped);
    pageRefs.current[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pages.length]);

  const handleRegisterPageRef = useCallback((pageIdx: number, el: HTMLDivElement | null) => {
    pageRefs.current[pageIdx] = el;
  }, []);

  const handleAddAnnotation = useCallback(
    (
      pageIndex: number,
      ann: EditorAnnotation,
      autoSelect = true,
      autoEdit = false,
    ) => {
      commitPagesChange((prev) =>
        prev.map((pg, idx) =>
          idx === pageIndex ? { ...pg, annotations: [...pg.annotations, ann] } : pg,
        ),
      );
      if (autoSelect) setSelectedAnnId(ann.id);
      if (autoEdit) setEditingTextId(ann.id);
      if (
        ann.kind !== 'text' &&
        ann.kind !== 'freehand' &&
        ann.kind !== 'whiteout' &&
        ann.kind !== 'shape'
      ) {
        setToolMode('select');
      }
    },
    [commitPagesChange],
  );

  const handleUpdateAnnotation = useCallback(
    (
      pageIndex: number,
      annId: string,
      patch: Partial<EditorAnnotation>,
      pushHistory = true,
    ) => {
      commitPagesChange(
        (prev) =>
          prev.map((pg, idx) => {
            if (idx !== pageIndex) return pg;
            return {
              ...pg,
              annotations: pg.annotations.map((a) =>
                a.id === annId ? ({ ...a, ...patch } as EditorAnnotation) : a,
              ),
            };
          }),
        pushHistory,
      );
    },
    [commitPagesChange],
  );

  // Selected annotation lookup across all pages
  const selectedContext = useMemo(() => {
    if (!selectedAnnId) return null;
    for (let i = 0; i < pages.length; i += 1) {
      const found = pages[i].annotations.find((a) => a.id === selectedAnnId);
      if (found) return { pageIndex: i, ann: found };
    }
    return null;
  }, [pages, selectedAnnId]);

  const handleDeleteSelected = () => {
    if (!selectedContext) return;
    commitPagesChange((prev) =>
      prev.map((pg, idx) =>
        idx === selectedContext.pageIndex
          ? { ...pg, annotations: pg.annotations.filter((a) => a.id !== selectedContext.ann.id) }
          : pg,
      ),
    );
    setSelectedAnnId(null);
    setEditingTextId(null);
  };

  const handleDuplicateSelected = () => {
    if (!selectedContext) return;
    const clone = JSON.parse(JSON.stringify(selectedContext.ann)) as EditorAnnotation;
    clone.id = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if ('x' in clone && 'y' in clone) {
      clone.x += 16;
      clone.y += 16;
    }
    if (clone.kind === 'text') delete clone.coverRect;
    handleAddAnnotation(selectedContext.pageIndex, clone, true, false);
  };

  // Insert Image
  const handlePickImage = async () => {
    const files = await pickFiles({
      title: 'Insert Image into PDF',
      accept: 'image/png,image/jpeg,image/webp',
      filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (!files.length) return;
    const f = files[0];
    const lower = f.name.toLowerCase();
    const mime =
      lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'image/jpeg'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
    const dataUrl = await bytesToDataUrl(f.bytes, mime);

    const img = new Image();
    img.onload = () => {
      const targetPage = pages[activePageIndex];
      const maxW = (targetPage?.baseWidth || 595) * 0.45;
      const ratio = Math.min(1, maxW / Math.max(1, img.naturalWidth));
      const w = Math.max(40, Math.round(img.naturalWidth * ratio));
      const h = Math.max(40, Math.round(img.naturalHeight * ratio));

      handleAddAnnotation(
        activePageIndex,
        {
          id: `img-${Date.now()}`,
          kind: 'image',
          x: 70,
          y: 90,
          width: w,
          height: h,
          dataUrl,
          opacity: 1,
        },
        true,
        false,
      );
    };
    img.src = dataUrl;
  };

  // Insert Signature
  const handleSelectSignature = (dataUrl: string) => {
    setShowSigModal(false);
    const img = new Image();
    img.onload = () => {
      const targetW = 160;
      const ratio = targetW / Math.max(1, img.naturalWidth);
      const targetH = Math.max(36, Math.round(img.naturalHeight * ratio));
      handleAddAnnotation(
        activePageIndex,
        {
          id: `sig-${Date.now()}`,
          kind: 'signature',
          x: 110,
          y: 160,
          width: targetW,
          height: targetH,
          dataUrl,
          opacity: 1,
        },
        true,
        false,
      );
    };
    img.src = dataUrl;
  };

  // Sidebar page actions
  const rotatePage = (idx: number, delta: number) => {
    commitPagesChange((prev) =>
      prev.map((pg, i) =>
        i === idx ? { ...pg, rotation: ((pg.rotation + delta) % 360 + 360) % 360 } : pg,
      ),
    );
  };

  const movePage = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pages.length) return;
    commitPagesChange((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
    setActivePageIndex(target);
  };

  const duplicatePage = (idx: number) => {
    commitPagesChange((prev) => {
      const src = prev[idx];
      const copy: EditorPageState = {
        ...JSON.parse(JSON.stringify(src)),
        id: `pg-dup-${Date.now()}`,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const insertBlankPageAfter = (idx: number) => {
    const ref = pages[idx];
    commitPagesChange((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, {
        id: `pg-blank-${Date.now()}`,
        sourceDocIndex: -1,
        sourcePageIndex: -1,
        rotation: 0,
        baseWidth: ref?.baseWidth || 595,
        baseHeight: ref?.baseHeight || 842,
        annotations: [],
      });
      return next;
    });
  };

  const deletePage = (idx: number) => {
    if (pages.length <= 1) return;
    commitPagesChange((prev) => prev.filter((_, i) => i !== idx));
    setActivePageIndex((cur) => Math.max(0, Math.min(pages.length - 2, cur)));
  };

  const handleInsertExternalPdf = async () => {
    const files = await pickFiles({
      title: 'Insert Pages from Another PDF',
      accept: '.pdf,application/pdf',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });
    if (!files.length) return;
    const f: SelectedBinaryFile = files[0];
    try {
      const proxy = await loadPdfJsDocument(f.bytes);
      const docIdx = sourceDocs.length;
      const newPages: EditorPageState[] = [];
      for (let p = 1; p <= proxy.numPages; p += 1) {
        const page = await proxy.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        newPages.push({
          id: `pg-ext-${Date.now()}-${p}`,
          sourceDocIndex: docIdx,
          sourcePageIndex: p - 1,
          rotation: 0,
          baseWidth: vp.width,
          baseHeight: vp.height,
          annotations: [],
        });
      }
      setSourceDocs((prev) => [...prev, { bytes: f.bytes, name: f.name }]);
      setPdfProxies((prev) => [...prev, proxy]);
      commitPagesChange((prev) => [...prev, ...newPages]);
    } catch (err) {
      alert(`Could not insert PDF: ${String((err as Error)?.message || err)}`);
    }
  };

  // Find & Replace across entire PDF
  const runSearch = async () => {
    const q = findQuery.trim().toLowerCase();
    if (!q) {
      setSearchMatches([]);
      return;
    }
    setSearching(true);
    const matches: SearchMatch[] = [];
    try {
      for (let i = 0; i < pages.length; i += 1) {
        const pg = pages[i];
        if (pg.sourceDocIndex < 0 || pg.sourcePageIndex < 0) continue;
        const proxy = pdfProxies[pg.sourceDocIndex];
        if (!proxy) continue;

        const pdfPage = await proxy.getPage(pg.sourcePageIndex + 1);
        const vp = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + pg.rotation) % 360 });
        const offscreen = document.createElement('canvas');
        offscreen.width = Math.max(1, Math.floor(vp.width));
        offscreen.height = Math.max(1, Math.floor(vp.height));
        const ctx = offscreen.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

        const blocks = await extractDetectedTextBlocks({
          page: pdfPage,
          canvas: offscreen,
          scale: 1,
          rotationDelta: pg.rotation,
        });

        for (const blk of blocks) {
          if (blk.text.toLowerCase().includes(q)) {
            matches.push({
              pageIndex: i,
              x: blk.x,
              y: blk.y,
              width: blk.width,
              height: blk.height,
              fullText: blk.text,
              fontSize: blk.fontSize,
              fontFamily: blk.fontFamily,
              bold: blk.bold,
              italic: blk.italic,
              color: blk.color,
              backgroundColor: blk.backgroundColor,
            });
          }
        }
      }
      setSearchMatches(matches);
      setActiveMatchIdx(0);
      if (matches.length > 0) {
        scrollToPage(matches[0].pageIndex);
      }
    } finally {
      setSearching(false);
    }
  };

  const replaceMatches = (all: boolean) => {
    if (!searchMatches.length || !findQuery.trim()) return;
    const regex = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const targets = all ? searchMatches : [searchMatches[activeMatchIdx]].filter(Boolean);

    commitPagesChange((prev) => {
      const next = prev.map((pg) => ({ ...pg, annotations: [...pg.annotations] }));
      for (const m of targets) {
        const replaced = m.fullText.replace(regex, replaceText);
        next[m.pageIndex].annotations.push({
          id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'text',
          x: m.x,
          y: m.y,
          width: Math.max(m.width + 30, 100),
          height: Math.max(m.height + 6, 20),
          text: replaced,
          fontFamily: m.fontFamily,
          fontSize: m.fontSize,
          bold: m.bold,
          italic: m.italic,
          color: m.color,
          align: 'left',
          isReplacedExisting: true,
          coverRect: {
            x: m.x,
            y: m.y,
            width: m.width,
            height: m.height,
            color: m.backgroundColor,
          },
        });
      }
      return next;
    });
    setSearchMatches([]);
  };

  const handleFitWidth = () => {
    const vpEl = viewportRef.current;
    const pg = pages[activePageIndex];
    if (!vpEl || !pg) return;
    const available = Math.max(320, vpEl.clientWidth - 76);
    const nextZoom = Math.min(2.2, Math.max(0.5, available / (pg.baseWidth || 595)));
    setZoom(Math.round(nextZoom * 100) / 100);
  };

  if (!initialFile) {
    return (
      <div className="main-scroll">
        <div className="container-lg" style={{ paddingTop: 28 }}>
          <div className="tool-page-title" style={{ marginBottom: 18 }}>
            <div className="tool-icon-box" style={{ background: '#0ea96b' }}>
              <PenTool size={20} />
            </div>
            <div>
              <h1>PDF Editor</h1>
              <p>
                Open any PDF to edit existing text inline, whiteout, draw, add forms, links,
                images, and signatures.
              </p>
            </div>
          </div>
          <FileDropzone
            title="Drop a PDF file to start editing"
            subtitle="Edit text, sign, annotate, fill forms, and organize pages offline"
            buttonLabel="Open PDF File"
            onFilesSelected={(files) => {
              if (files[0]) onOpenSelectedFile(files[0]);
            }}
            onCreateBlankPdf={onCreateBlankPdf}
          />
        </div>
      </div>
    );
  }

  const selectedAnn = selectedContext?.ann || null;

  return (
    <div className="editor-shell">
      {/* Main Sejda-style Editor Ribbon */}
      <div className="editor-ribbon">
        <div className="ribbon-group">
          <button
            className={`tool-chip ${showSidebar ? 'active' : ''}`}
            onClick={() => setShowSidebar((s) => !s)}
            title="Toggle Page Thumbnails"
          >
            <PanelLeft size={15} />
          </button>
          <button
            className={`tool-chip ${toolMode === 'select' ? 'active' : ''}`}
            onClick={() => setToolMode('select')}
            title="Select & Move Objects (Esc)"
          >
            <MousePointer2 size={15} />
            <span>Select</span>
          </button>
        </div>

        <div className="ribbon-group">
          <button
            className={`tool-chip ${toolMode === 'text' ? 'active' : ''}`}
            onClick={() => setToolMode('text')}
            title="Click existing PDF text to edit inline, or click empty area to add text"
          >
            <Type size={15} />
            <span>Text</span>
          </button>

          <button
            className={`tool-chip ${toolMode === 'link' ? 'active' : ''}`}
            onClick={() => setToolMode('link')}
            title="Add Web Link or Page Jump Link"
          >
            <Link2 size={15} />
            <span>Links</span>
          </button>

          <div className="dropdown-menu" ref={formsMenuRef}>
            <button
              className={`tool-chip ${
                toolMode === 'formText' ||
                toolMode === 'formCheckbox' ||
                toolMode === 'formDropdown'
                  ? 'active'
                  : ''
              }`}
              onClick={() => setShowFormsMenu((v) => !v)}
            >
              <CheckSquare size={15} />
              <span>Forms</span>
            </button>
            {showFormsMenu && (
              <div className="dropdown-panel" style={{ minWidth: 190 }}>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('formText');
                    setShowFormsMenu(false);
                  }}
                >
                  <span>Text Field</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('formCheckbox');
                    setShowFormsMenu(false);
                  }}
                >
                  <span>Checkbox</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('formDropdown');
                    setShowFormsMenu(false);
                  }}
                >
                  <span>Dropdown Menu</span>
                </button>
              </div>
            )}
          </div>

          <button className="tool-chip" onClick={handlePickImage} title="Insert PNG/JPG/WebP Image">
            <ImageIcon size={15} />
            <span>Images</span>
          </button>

          <button
            className="tool-chip"
            onClick={() => setShowSigModal(true)}
            title="Draw, Type, or Upload Signature"
          >
            <PenTool size={15} />
            <span>Sign</span>
          </button>

          <button
            className={`tool-chip ${toolMode === 'whiteout' ? 'active' : ''}`}
            onClick={() => setToolMode('whiteout')}
            title="Whiteout / Redact Region"
          >
            <Eraser size={15} />
            <span>Whiteout</span>
          </button>
        </div>

        <div className="ribbon-group">
          <button
            className={`tool-chip ${toolMode === 'highlight' ? 'active' : ''}`}
            onClick={() => setToolMode('highlight')}
          >
            <Highlighter size={15} />
            <span>Highlight</span>
          </button>

          <button
            className={`tool-chip ${toolMode === 'draw' ? 'active' : ''}`}
            onClick={() => setToolMode('draw')}
          >
            <PenTool size={15} />
            <span>Draw</span>
          </button>

          <div className="dropdown-menu" ref={annotateMenuRef}>
            <button
              className={`tool-chip ${
                toolMode === 'rect' ||
                toolMode === 'ellipse' ||
                toolMode === 'line' ||
                toolMode === 'arrow' ||
                toolMode === 'note'
                  ? 'active'
                  : ''
              }`}
              onClick={() => setShowAnnotateMenu((v) => !v)}
            >
              <Square size={15} />
              <span>Shapes & Note</span>
            </button>
            {showAnnotateMenu && (
              <div className="dropdown-panel" style={{ minWidth: 180 }}>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('rect');
                    setShowAnnotateMenu(false);
                  }}
                >
                  <Square size={14} /> <span>Rectangle</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('ellipse');
                    setShowAnnotateMenu(false);
                  }}
                >
                  <Circle size={14} /> <span>Ellipse / Circle</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('line');
                    setShowAnnotateMenu(false);
                  }}
                >
                  <Minus size={14} /> <span>Line</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('arrow');
                    setShowAnnotateMenu(false);
                  }}
                >
                  <ArrowUpRight size={14} /> <span>Arrow</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setToolMode('note');
                    setShowAnnotateMenu(false);
                  }}
                >
                  <MessageSquare size={14} /> <span>Sticky Note</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="ribbon-group">
          <button
            className={`tool-chip ${showFindBar ? 'active' : ''}`}
            onClick={() => setShowFindBar((v) => !v)}
            title="Find & Replace Text (Ctrl+F)"
          >
            <Search size={15} />
            <span>Find & Replace</span>
          </button>
        </div>

        <div className="ribbon-group" style={{ marginLeft: 'auto', borderRight: 'none' }}>
          <button
            className="icon-btn"
            disabled={undoStack.length === 0}
            onClick={handleUndo}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-btn"
            disabled={redoStack.length === 0}
            onClick={handleRedo}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>

      {/* Contextual Properties Sub-bar */}
      {(toolMode !== 'select' || selectedAnn) && (
        <div className="editor-subbar">
          {(toolMode === 'text' || selectedAnn?.kind === 'text') && (
            <>
              <select
                className="select"
                style={{ width: 120, padding: '4px 8px' }}
                value={
                  selectedAnn?.kind === 'text' ? selectedAnn.fontFamily : defaults.fontFamily
                }
                onChange={(e) => {
                  const val = e.target.value as FontFamilyChoice;
                  if (selectedContext && selectedAnn?.kind === 'text') {
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      fontFamily: val,
                    });
                  } else {
                    setDefaults((d) => ({ ...d, fontFamily: val }));
                  }
                }}
              >
                <option value="Helvetica">Helvetica</option>
                <option value="Times">Times Roman</option>
                <option value="Courier">Courier</option>
              </select>

              <input
                type="number"
                className="input"
                min={6}
                max={96}
                style={{ width: 66, padding: '4px 8px' }}
                value={
                  selectedAnn?.kind === 'text' ? selectedAnn.fontSize : defaults.fontSize
                }
                onChange={(e) => {
                  const val = Math.max(6, Math.min(96, Number(e.target.value) || 12));
                  if (selectedContext && selectedAnn?.kind === 'text') {
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      fontSize: val,
                    });
                  } else {
                    setDefaults((d) => ({ ...d, fontSize: val }));
                  }
                }}
              />

              <button
                className={`icon-btn ${
                  (selectedAnn?.kind === 'text' ? selectedAnn.bold : defaults.bold)
                    ? 'active'
                    : ''
                }`}
                onClick={() => {
                  if (selectedContext && selectedAnn?.kind === 'text') {
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      bold: !selectedAnn.bold,
                    });
                  } else {
                    setDefaults((d) => ({ ...d, bold: !d.bold }));
                  }
                }}
                title="Bold"
              >
                <Bold size={15} />
              </button>

              <button
                className={`icon-btn ${
                  (selectedAnn?.kind === 'text' ? selectedAnn.italic : defaults.italic)
                    ? 'active'
                    : ''
                }`}
                onClick={() => {
                  if (selectedContext && selectedAnn?.kind === 'text') {
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      italic: !selectedAnn.italic,
                    });
                  } else {
                    setDefaults((d) => ({ ...d, italic: !d.italic }));
                  }
                }}
                title="Italic"
              >
                <Italic size={15} />
              </button>

              {selectedContext && selectedAnn?.kind === 'text' && (
                <>
                  {(['left', 'center', 'right'] as const).map((al) => (
                    <button
                      key={al}
                      className={`icon-btn ${selectedAnn.align === al ? 'active' : ''}`}
                      onClick={() =>
                        handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                          align: al,
                        })
                      }
                    >
                      {al === 'left' ? (
                        <AlignLeft size={14} />
                      ) : al === 'center' ? (
                        <AlignCenter size={14} />
                      ) : (
                        <AlignRight size={14} />
                      )}
                    </button>
                  ))}
                </>
              )}

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>Color</span>
                <input
                  type="color"
                  value={
                    selectedAnn?.kind === 'text' ? selectedAnn.color : defaults.textColor
                  }
                  onChange={(e) => {
                    const col = e.target.value;
                    if (selectedContext && selectedAnn?.kind === 'text') {
                      handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                        color: col,
                      });
                    } else {
                      setDefaults((d) => ({ ...d, textColor: col }));
                    }
                  }}
                />
              </label>

              {selectedContext && (selectedAnn as TextAnnotation)?.coverRect && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span>Cover Bg</span>
                  <input
                    type="color"
                    value={(selectedAnn as TextAnnotation).coverRect!.color}
                    onChange={(e) => {
                      const tx = selectedAnn as TextAnnotation;
                      handleUpdateAnnotation(selectedContext.pageIndex, tx.id, {
                        coverRect: { ...tx.coverRect!, color: e.target.value },
                      });
                    }}
                  />
                </label>
              )}
            </>
          )}

          {(toolMode === 'draw' ||
            toolMode === 'rect' ||
            toolMode === 'ellipse' ||
            toolMode === 'line' ||
            toolMode === 'arrow' ||
            selectedAnn?.kind === 'shape' ||
            selectedAnn?.kind === 'freehand') && (
            <>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>Stroke</span>
                <input
                  type="color"
                  value={
                    selectedAnn?.kind === 'shape'
                      ? selectedAnn.strokeColor
                      : selectedAnn?.kind === 'freehand'
                        ? selectedAnn.color
                        : defaults.strokeColor
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (selectedContext && selectedAnn?.kind === 'shape') {
                      handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                        strokeColor: val,
                        fillColor:
                          selectedAnn.shapeType === 'highlight' ? val : selectedAnn.fillColor,
                      });
                    } else if (selectedContext && selectedAnn?.kind === 'freehand') {
                      handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                        color: val,
                      });
                    } else {
                      setDefaults((d) => ({ ...d, strokeColor: val }));
                    }
                  }}
                />
              </label>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span>Width</span>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={18}
                  style={{ width: 58, padding: '4px 6px' }}
                  value={
                    selectedAnn?.kind === 'shape' || selectedAnn?.kind === 'freehand'
                      ? selectedAnn.strokeWidth
                      : defaults.strokeWidth
                  }
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value) || 2);
                    if (
                      selectedContext &&
                      (selectedAnn?.kind === 'shape' || selectedAnn?.kind === 'freehand')
                    ) {
                      handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                        strokeWidth: val,
                      });
                    } else {
                      setDefaults((d) => ({ ...d, strokeWidth: val }));
                    }
                  }}
                />
              </label>
            </>
          )}

          {(toolMode === 'whiteout' || selectedAnn?.kind === 'whiteout') && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span>Cover Color</span>
              <input
                type="color"
                value={
                  selectedAnn?.kind === 'whiteout' ? selectedAnn.color : defaults.whiteoutColor
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (selectedContext && selectedAnn?.kind === 'whiteout') {
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      color: val,
                    });
                  } else {
                    setDefaults((d) => ({ ...d, whiteoutColor: val }));
                  }
                }}
              />
            </label>
          )}

          {selectedContext && selectedAnn?.kind === 'link' && (
            <>
              <select
                className="select"
                style={{ width: 120, padding: '4px 8px' }}
                value={(selectedAnn as LinkAnnotation).linkType}
                onChange={(e) =>
                  handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                    linkType: e.target.value as 'url' | 'page',
                  })
                }
              >
                <option value="url">Web URL</option>
                <option value="page">Go to Page</option>
              </select>
              {(selectedAnn as LinkAnnotation).linkType === 'url' ? (
                <input
                  type="text"
                  className="input"
                  style={{ width: 260, padding: '4px 8px' }}
                  value={(selectedAnn as LinkAnnotation).url}
                  onChange={(e) =>
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      url: e.target.value,
                    })
                  }
                  placeholder="https://..."
                />
              ) : (
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={pages.length}
                  style={{ width: 90, padding: '4px 8px' }}
                  value={(selectedAnn as LinkAnnotation).targetPage}
                  onChange={(e) =>
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      targetPage: Math.max(1, Math.min(pages.length, Number(e.target.value) || 1)),
                    })
                  }
                />
              )}
            </>
          )}

          {selectedContext && selectedAnn?.kind === 'form' && (
            <>
              <input
                type="text"
                className="input"
                style={{ width: 140, padding: '4px 8px' }}
                value={(selectedAnn as FormFieldAnnotation).name}
                onChange={(e) =>
                  handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                    name: e.target.value,
                  })
                }
                placeholder="Field name"
              />
              {(selectedAnn as FormFieldAnnotation).fieldType === 'checkbox' ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <input
                    type="checkbox"
                    checked={(selectedAnn as FormFieldAnnotation).checked}
                    onChange={(e) =>
                      handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                        checked: e.target.checked,
                      })
                    }
                  />
                  <span>Checked by default</span>
                </label>
              ) : (
                <input
                  type="text"
                  className="input"
                  style={{ width: 180, padding: '4px 8px' }}
                  value={(selectedAnn as FormFieldAnnotation).value}
                  onChange={(e) =>
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      value: e.target.value,
                    })
                  }
                  placeholder="Default value"
                />
              )}
              {(selectedAnn as FormFieldAnnotation).fieldType === 'dropdown' && (
                <input
                  type="text"
                  className="input"
                  style={{ width: 210, padding: '4px 8px' }}
                  value={(selectedAnn as FormFieldAnnotation).options.join(', ')}
                  onChange={(e) =>
                    handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                      options: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Options comma-separated"
                />
              )}
            </>
          )}

          {selectedContext && selectedAnn?.kind === 'note' && (
            <input
              type="text"
              className="input"
              style={{ width: 280, padding: '4px 8px' }}
              value={(selectedAnn as NoteAnnotation).text}
              onChange={(e) =>
                handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                  text: e.target.value,
                })
              }
              placeholder="Sticky note message..."
            />
          )}

          {selectedContext && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {(selectedAnn?.kind === 'image' ||
                selectedAnn?.kind === 'signature' ||
                selectedAnn?.kind === 'shape') && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={(selectedAnn as ShapeAnnotation).opacity ?? 1}
                    onChange={(e) =>
                      handleUpdateAnnotation(selectedContext.pageIndex, selectedAnn.id, {
                        opacity: Number(e.target.value),
                      })
                    }
                  />
                </label>
              )}
              <button className="btn btn-sm" onClick={handleDuplicateSelected}>
                <Copy size={13} /> Duplicate
              </button>
              <button
                className="btn btn-sm"
                style={{ color: 'var(--danger)' }}
                onClick={handleDeleteSelected}
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          )}
        </div>
      )}

      {/* Find & Replace Drawer Bar */}
      {showFindBar && (
        <div
          className="editor-subbar"
          style={{
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-strong)',
          }}
        >
          <Search size={14} style={{ color: 'var(--brand)' }} />
          <input
            type="text"
            className="input"
            style={{ width: 190, padding: '4px 8px' }}
            placeholder="Find text..."
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
          <button className="btn btn-sm" onClick={runSearch} disabled={searching}>
            {searching ? 'Searching...' : 'Find'}
          </button>

          <input
            type="text"
            className="input"
            style={{ width: 190, padding: '4px 8px' }}
            placeholder="Replace with..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={!searchMatches.length}
            onClick={() => replaceMatches(false)}
          >
            Replace
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!searchMatches.length}
            onClick={() => replaceMatches(true)}
          >
            Replace All ({searchMatches.length})
          </button>

          {searchMatches.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>
                {activeMatchIdx + 1} / {searchMatches.length}
              </span>
              <button
                className="icon-btn"
                onClick={() => {
                  const next = (activeMatchIdx - 1 + searchMatches.length) % searchMatches.length;
                  setActiveMatchIdx(next);
                  scrollToPage(searchMatches[next].pageIndex);
                }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="icon-btn"
                onClick={() => {
                  const next = (activeMatchIdx + 1) % searchMatches.length;
                  setActiveMatchIdx(next);
                  scrollToPage(searchMatches[next].pageIndex);
                }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          <button
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              setShowFindBar(false);
              setSearchMatches([]);
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="editor-body">
        {/* Page Thumbnails Sidebar */}
        {showSidebar && (
          <aside className="editor-sidebar">
            <div className="editor-sidebar-header">
              <span>Pages ({pages.length})</span>
              <button
                className="icon-btn"
                style={{ width: 24, height: 24 }}
                onClick={() => insertBlankPageAfter(pages.length - 1)}
                title="Add Blank Page"
              >
                <FilePlus2 size={14} />
              </button>
            </div>

            <div className="editor-sidebar-list">
              {pages.map((pg, idx) => (
                <div
                  key={pg.id}
                  className={`sidebar-thumb ${activePageIndex === idx ? 'active' : ''}`}
                  onClick={() => scrollToPage(idx)}
                >
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                    <PdfThumbnail
                      pdfDoc={pg.sourceDocIndex >= 0 ? pdfProxies[pg.sourceDocIndex] : null}
                      pageNumber={pg.sourcePageIndex + 1}
                      rotationDelta={pg.rotation}
                      width={134}
                      maxHeight={156}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11.5,
                    }}
                  >
                    <strong>{idx + 1}</strong>
                    <div
                      style={{ display: 'flex', gap: 2 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        disabled={idx === 0}
                        onClick={() => movePage(idx, -1)}
                        title="Move Up"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        disabled={idx === pages.length - 1}
                        onClick={() => movePage(idx, 1)}
                        title="Move Down"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        onClick={() => rotatePage(idx, -90)}
                        title="Rotate Left"
                      >
                        <RotateCcw size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        onClick={() => rotatePage(idx, 90)}
                        title="Rotate Right"
                      >
                        <RotateCw size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        onClick={() => duplicatePage(idx)}
                        title="Duplicate Page"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 22, height: 22, color: 'var(--danger)' }}
                        disabled={pages.length <= 1}
                        onClick={() => deletePage(idx)}
                        title="Delete Page"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
              <button
                className="btn btn-sm"
                style={{ width: '100%' }}
                onClick={handleInsertExternalPdf}
              >
                <FilePlus2 size={13} />
                <span>Insert PDF Pages...</span>
              </button>
            </div>
          </aside>
        )}

        {/* Main Scrollable Document Canvas */}
        <div className="editor-viewport" ref={viewportRef}>
          {pages.map((pg, idx) => (
            <EditorPageCanvas
              key={pg.id}
              pageState={pg}
              pageNumber={idx + 1}
              pdfDocs={pdfProxies}
              zoom={zoom}
              toolMode={toolMode}
              defaults={defaults}
              selectedAnnotationId={selectedAnnId}
              editingTextId={editingTextId}
              highlightMatchRects={searchMatches.filter((m) => m.pageIndex === idx)}
              onSelectPage={setActivePageIndex}
              onSelectAnnotation={setSelectedAnnId}
              onStartEditText={setEditingTextId}
              onAddAnnotation={handleAddAnnotation}
              onUpdateAnnotation={handleUpdateAnnotation}
              onRegisterPageRef={handleRegisterPageRef}
            />
          ))}
        </div>
      </div>

      {/* Floating Zoom & Page Navigation Pill */}
      <div className="floating-zoom-bar">
        <button
          className="icon-btn"
          disabled={activePageIndex <= 0}
          onClick={() => scrollToPage(activePageIndex - 1)}
          title="Previous Page"
        >
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 12.5, fontWeight: 600, padding: '0 4px' }}>
          Page {activePageIndex + 1} / {pages.length}
        </span>
        <button
          className="icon-btn"
          disabled={activePageIndex >= pages.length - 1}
          onClick={() => scrollToPage(activePageIndex + 1)}
          title="Next Page"
        >
          <ChevronRight size={16} />
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

        <button
          className="icon-btn"
          onClick={() => setZoom((z) => Math.max(0.45, Math.round((z - 0.15) * 100) / 100))}
          title="Zoom Out"
        >
          <ZoomOut size={15} />
        </button>
        <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 44, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="icon-btn"
          onClick={() => setZoom((z) => Math.min(2.6, Math.round((z + 0.15) * 100) / 100))}
          title="Zoom In"
        >
          <ZoomIn size={15} />
        </button>
        <button className="btn btn-sm" onClick={handleFitWidth}>
          Fit Width
        </button>
      </div>

      {showSigModal && (
        <SignatureModal
          onSelectSignature={handleSelectSignature}
          onClose={() => setShowSigModal(false)}
        />
      )}
    </div>
  );
};
