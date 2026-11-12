import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PDFDocument } from '@cantoo/pdf-lib';
import type { RecentFileRecord, ToolId } from './types/pdf';
import {
  clearRecentFiles,
  getRecentFiles,
  pickFiles,
  recordRecentFile,
  saveBinaryFile,
  stripExtension,
  type SelectedBinaryFile,
} from './utils/fileBridge';
import { exportEditedPdf } from './utils/pdfExporter';
import {
  PdfPasswordRequiredError,
  getPdfMetadataSummary,
} from './utils/pdfRenderer';
import { TopBar } from './components/TopBar';
import { PasswordModal } from './components/PasswordModal';
import { ToolsHub } from './pages/ToolsHub';
import { PdfEditorView } from './pages/PdfEditorView';
import { MergeTool } from './pages/tools/MergeTool';
import { SplitTool } from './pages/tools/SplitTool';
import { CompressTool } from './pages/tools/CompressTool';
import { OrganizePagesTool } from './pages/tools/OrganizePagesTool';
import { WatermarkTool } from './pages/tools/WatermarkTool';
import { HeaderFooterTool } from './pages/tools/HeaderFooterTool';
import { ProtectUnlockTool } from './pages/tools/ProtectUnlockTool';
import { ConvertImagesTool } from './pages/tools/ConvertImagesTool';
import { CropTool } from './pages/tools/CropTool';
import { FlattenMetadataTool } from './pages/tools/FlattenMetadataTool';

interface ActiveEditorFile {
  name: string;
  path?: string;
  size: number;
  bytes: Uint8Array;
  password?: string;
}

const THEME_KEY = 'jadepdf_dark_mode_v1';

export const App: React.FC = () => {
  const [activeTool, setActiveTool] = useState<ToolId>('home');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [recentFiles, setRecentFiles] = useState<RecentFileRecord[]>(() => getRecentFiles());

  const [editorFile, setEditorFile] = useState<ActiveEditorFile | null>(null);
  const [editorMeta, setEditorMeta] = useState<{
    fileName?: string;
    pageCount?: number;
    isDirty: boolean;
  }>({ isDirty: false });
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [pendingEditorPassword, setPendingEditorPassword] = useState<{
    file: SelectedBinaryFile;
    error?: string;
  } | null>(null);

  const editorApiRef = useRef<{
    exportBytes: () => Promise<Uint8Array>;
    undo: () => void;
    redo: () => void;
    openFind: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    markSaved: () => void;
  } | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    try {
      localStorage.setItem(THEME_KEY, darkMode ? '1' : '0');
    } catch {
      // Ignore
    }
  }, [darkMode]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  const openFileIntoEditor = useCallback(
    async (file: SelectedBinaryFile, password?: string) => {
      try {
        await getPdfMetadataSummary(file.bytes, password);
        setEditorFile({
          name: file.name,
          path: file.path,
          size: file.size,
          bytes: file.bytes,
          password,
        });
        if (file.path) {
          recordRecentFile({ name: file.name, path: file.path, size: file.size });
          setRecentFiles(getRecentFiles());
        }
        setActiveTool('editor');
      } catch (err) {
        if (err instanceof PdfPasswordRequiredError) {
          setPendingEditorPassword({
            file,
            error: err.reason === 'incorrect_password' ? 'Incorrect password.' : undefined,
          });
          return;
        }
        showToast(`Could not open PDF: ${String((err as Error)?.message || err)}`);
      }
    },
    [showToast],
  );

  const handleOpenPdfPrompt = useCallback(async () => {
    const picked = await pickFiles({
      title: 'Open PDF Document',
      accept: '.pdf,application/pdf',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });
    if (picked[0]) {
      await openFileIntoEditor(picked[0]);
    }
  }, [openFileIntoEditor]);

  const handleCreateBlankPdf = useCallback(async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    const bytes = await doc.save();
    setEditorFile({
      name: 'Untitled.pdf',
      size: bytes.byteLength,
      bytes,
    });
    setActiveTool('editor');
  }, []);

  const handleOpenRecentFile = useCallback(
    async (record: RecentFileRecord) => {
      if (!window.electronAPI) {
        showToast('Recent file path access requires the desktop app.');
        return;
      }
      try {
        const loaded = await window.electronAPI.readFileByPath(record.path);
        await openFileIntoEditor({
          name: loaded.name,
          path: loaded.path,
          size: loaded.size,
          bytes: loaded.data instanceof Uint8Array ? loaded.data : new Uint8Array(loaded.data),
        });
      } catch (err) {
        showToast(`File not found or unreadable: ${record.name}`);
      }
    },
    [openFileIntoEditor, showToast],
  );

  const handleEditorSaveAs = useCallback(async () => {
    if (!editorApiRef.current || !editorFile) return;
    setIsSaving(true);
    try {
      const outBytes = await editorApiRef.current.exportBytes();
      const suggested = `${stripExtension(editorFile.name)}_edited.pdf`;
      const res = await saveBinaryFile({ defaultName: suggested, data: outBytes });
      if (res.saved) {
        editorApiRef.current.markSaved();
        if (res.filePath) {
          const name = res.filePath.split(/[/\\]/).pop() || suggested;
          recordRecentFile({ name, path: res.filePath, size: outBytes.byteLength });
          setRecentFiles(getRecentFiles());
          setEditorFile((prev) =>
            prev ? { ...prev, name, path: res.filePath || undefined, size: outBytes.byteLength } : prev,
          );
        }
        showToast('PDF saved successfully.');
      }
    } catch (err) {
      showToast(`Save failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setIsSaving(false);
    }
  }, [editorFile, showToast]);

  const handleEditorSave = useCallback(async () => {
    if (!editorApiRef.current || !editorFile) return;
    if (editorFile.path && window.electronAPI) {
      setIsSaving(true);
      try {
        const outBytes = await editorApiRef.current.exportBytes();
        await window.electronAPI.writeFileByPath(editorFile.path, outBytes);
        editorApiRef.current.markSaved();
        showToast(`Saved changes to ${editorFile.name}`);
      } catch (err) {
        showToast(`Save failed: ${String((err as Error)?.message || err)}`);
      } finally {
        setIsSaving(false);
      }
    } else {
      await handleEditorSaveAs();
    }
  }, [editorFile, handleEditorSaveAs, showToast]);

  const handleEditorPrint = useCallback(async () => {
    if (!editorApiRef.current || !editorFile) return;
    try {
      const outBytes = await editorApiRef.current.exportBytes();
      if (window.electronAPI) {
        await window.electronAPI.printPdf(outBytes, editorFile.name);
      } else {
        const blob = new Blob([outBytes as unknown as BlobPart], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (err) {
      showToast(`Print failed: ${String((err as Error)?.message || err)}`);
    }
  }, [editorFile, showToast]);

  // Listen to Windows Explorer double-click / Open With and native menu actions
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.consumePendingFile().then(async (filePath) => {
      if (!filePath) return;
      try {
        const loaded = await api.readFileByPath(filePath);
        await openFileIntoEditor({
          name: loaded.name,
          path: loaded.path,
          size: loaded.size,
          bytes: loaded.data instanceof Uint8Array ? loaded.data : new Uint8Array(loaded.data),
        });
      } catch {
        // Ignore invalid initial path
      }
    });

    const unsubOpen = api.onOpenFile(async (filePath) => {
      try {
        const loaded = await api.readFileByPath(filePath);
        await openFileIntoEditor({
          name: loaded.name,
          path: loaded.path,
          size: loaded.size,
          bytes: loaded.data instanceof Uint8Array ? loaded.data : new Uint8Array(loaded.data),
        });
      } catch {
        // Ignore
      }
    });

    const unsubMenu = api.onMenuAction((action) => {
      if (action === 'file:open') handleOpenPdfPrompt();
      else if (action === 'file:save') handleEditorSave();
      else if (action === 'file:saveAs') handleEditorSaveAs();
      else if (action === 'file:print') handleEditorPrint();
      else if (action === 'edit:undo') editorApiRef.current?.undo();
      else if (action === 'edit:redo') editorApiRef.current?.redo();
      else if (action === 'edit:find') editorApiRef.current?.openFind();
      else if (action === 'view:zoomIn') editorApiRef.current?.zoomIn();
      else if (action === 'view:zoomOut') editorApiRef.current?.zoomOut();
      else if (action === 'view:toggleTheme') setDarkMode((d) => !d);
      else if (action.startsWith('nav:')) {
        setActiveTool(action.slice(4) as ToolId);
      }
    });

    return () => {
      unsubOpen();
      unsubMenu();
    };
  }, [
    openFileIntoEditor,
    handleOpenPdfPrompt,
    handleEditorSave,
    handleEditorSaveAs,
    handleEditorPrint,
  ]);

  const registerExportApi = useCallback(
    (api: typeof editorApiRef.current) => {
      editorApiRef.current = api;
    },
    [],
  );

  return (
    <div className="app-shell">
      <TopBar
        activeTool={activeTool}
        onNavigate={setActiveTool}
        activeFileName={editorMeta.fileName}
        activePageCount={editorMeta.pageCount}
        isDirty={editorMeta.isDirty}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onOpenPdfForEditor={handleOpenPdfPrompt}
        recentFiles={recentFiles}
        onOpenRecentFile={handleOpenRecentFile}
        onClearRecentFiles={() => {
          clearRecentFiles();
          setRecentFiles([]);
        }}
        onEditorSave={handleEditorSave}
        onEditorSaveAs={handleEditorSaveAs}
        onEditorPrint={handleEditorPrint}
        isSaving={isSaving}
      />

      {activeTool === 'home' && (
        <ToolsHub
          onSelectTool={setActiveTool}
          onOpenFileInEditor={(f) => openFileIntoEditor(f)}
          onCreateBlankPdf={handleCreateBlankPdf}
          recentFiles={recentFiles}
          onOpenRecentFile={handleOpenRecentFile}
        />
      )}

      {activeTool === 'editor' && (
        <PdfEditorView
          initialFile={editorFile}
          onOpenSelectedFile={(f) => openFileIntoEditor(f)}
          onCreateBlankPdf={handleCreateBlankPdf}
          onDocumentStateChange={setEditorMeta}
          registerExportApi={registerExportApi}
          exportEditedPdf={exportEditedPdf}
        />
      )}

      {activeTool === 'merge' && (
        <MergeTool
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {activeTool === 'split' && <SplitTool onBack={() => setActiveTool('home')} />}

      {activeTool === 'compress' && (
        <CompressTool
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {(activeTool === 'organize' ||
        activeTool === 'delete' ||
        activeTool === 'extract' ||
        activeTool === 'rotate') && (
        <OrganizePagesTool
          mode={activeTool}
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {activeTool === 'watermark' && (
        <WatermarkTool
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {activeTool === 'headerFooter' && (
        <HeaderFooterTool
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {(activeTool === 'protect' || activeTool === 'unlock') && (
        <ProtectUnlockTool
          mode={activeTool}
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f, f.password)}
        />
      )}

      {(activeTool === 'imgToPdf' || activeTool === 'pdfToImg') && (
        <ConvertImagesTool
          mode={activeTool}
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {activeTool === 'crop' && (
        <CropTool
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {(activeTool === 'flatten' || activeTool === 'metadata') && (
        <FlattenMetadataTool
          mode={activeTool}
          onBack={() => setActiveTool('home')}
          onOpenInEditor={(f) => openFileIntoEditor(f)}
        />
      )}

      {pendingEditorPassword && (
        <PasswordModal
          fileName={pendingEditorPassword.file.name}
          errorMessage={pendingEditorPassword.error}
          onCancel={() => setPendingEditorPassword(null)}
          onSubmit={(pw) => {
            const target = pendingEditorPassword.file;
            setPendingEditorPassword(null);
            openFileIntoEditor(target, pw);
          }}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: '#0f172a',
            color: '#ffffff',
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: 'var(--shadow-lg)',
            zIndex: 120,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
};
