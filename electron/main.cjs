const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  shell,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Register custom secure scheme before app is ready so Vite + PDF.js ES module workers
// load seamlessly from inside app.asar without file:// CORS or Windows MIME issues.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function extractPdfArg(argv) {
  if (!Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || arg.startsWith('-')) continue;
    if (arg.toLowerCase().endsWith('.pdf') && fs.existsSync(arg)) {
      return path.resolve(arg);
    }
  }
  return null;
}

let mainWindow = null;
let pendingFilePath = extractPdfArg(process.argv);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const pdfPath = extractPdfArg(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (pdfPath) {
        mainWindow.webContents.send('app:open-file', pdfPath);
      }
    } else if (pdfPath) {
      pendingFilePath = pdfPath;
    }
  });
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', action);
  }
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('file:open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('file:save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('file:saveAs'),
        },
        { type: 'separator' },
        {
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendMenuAction('file:print'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendMenuAction('edit:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Y',
          click: () => sendMenuAction('edit:redo'),
        },
        { type: 'separator' },
        {
          label: 'Find & Replace',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenuAction('edit:find'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'All Tools Hub', click: () => sendMenuAction('nav:home') },
        { label: 'PDF Editor', click: () => sendMenuAction('nav:editor') },
        { type: 'separator' },
        { label: 'Merge PDFs', click: () => sendMenuAction('nav:merge') },
        { label: 'Split PDF', click: () => sendMenuAction('nav:split') },
        { label: 'Compress PDF', click: () => sendMenuAction('nav:compress') },
        { label: 'Organize Pages', click: () => sendMenuAction('nav:organize') },
        { label: 'Watermark', click: () => sendMenuAction('nav:watermark') },
        { label: 'Protect PDF', click: () => sendMenuAction('nav:protect') },
        { label: 'Unlock PDF', click: () => sendMenuAction('nav:unlock') },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => sendMenuAction('view:zoomIn'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => sendMenuAction('view:zoomOut'),
        },
        {
          label: 'Toggle Dark Mode',
          click: () => sendMenuAction('view:toggleTheme'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerAppProtocol() {
  const distDir = path.resolve(__dirname, '..', 'dist');
  protocol.handle('app', async (request) => {
    try {
      const parsed = new URL(request.url);
      let relPath = decodeURIComponent(parsed.pathname || '/');
      if (relPath.startsWith('/')) relPath = relPath.slice(1);
      if (!relPath) relPath = 'index.html';

      let targetPath = path.resolve(distDir, relPath);
      if (!targetPath.startsWith(distDir + path.sep) && targetPath !== distDir) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        targetPath = path.join(distDir, 'index.html');
      }

      const data = await fsp.readFile(targetPath);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(targetPath),
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err) {
      return new Response(`Error loading asset: ${String(err)}`, { status: 500 });
    }
  });
}

function createMainWindow() {
  const iconPath = path.resolve(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'JadePDF Editor',
    backgroundColor: '#f5f7f9',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadURL('app://local/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('dialog:openFiles', async (_event, options = {}) => {
    const properties = ['openFile'];
    if (options.multiSelections) properties.push('multiSelections');

    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select Files',
      filters: options.filters || [{ name: 'PDF Documents', extensions: ['pdf'] }],
      properties,
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, files: [] };
    }

    const files = [];
    for (const filePath of result.filePaths) {
      const stat = await fsp.stat(filePath);
      const buf = await fsp.readFile(filePath);
      files.push({
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        data: new Uint8Array(buf),
      });
    }
    return { canceled: false, files };
  });

  ipcMain.handle('dialog:saveFile', async (_event, options = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options.title || 'Save File',
      defaultPath: options.defaultPath || 'document.pdf',
      filters: options.filters || [{ name: 'PDF Document', extensions: ['pdf'] }],
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: null };
    }

    const buffer = Buffer.from(options.data);
    await fsp.writeFile(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('dialog:saveMultipleToFolder', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Choose Output Folder',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, folderPath: null, savedPaths: [] };
    }

    const folderPath = result.filePaths[0];
    const savedPaths = [];
    for (const item of options.files || []) {
      const safeName = path.basename(item.fileName || 'output.pdf').replace(/[<>:"/\\|?*]+/g, '_');
      const target = path.join(folderPath, safeName);
      await fsp.writeFile(target, Buffer.from(item.data));
      savedPaths.push(target);
    }

    return { canceled: false, folderPath, savedPaths };
  });

  ipcMain.handle('file:readPath', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path');
    }
    const resolved = path.resolve(filePath);
    const stat = await fsp.stat(resolved);
    const buf = await fsp.readFile(resolved);
    return {
      path: resolved,
      name: path.basename(resolved),
      size: stat.size,
      data: new Uint8Array(buf),
    };
  });

  ipcMain.handle('file:writePath', async (_event, filePath, data) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path');
    }
    const resolved = path.resolve(filePath);
    await fsp.writeFile(resolved, Buffer.from(data));
    return { ok: true, filePath: resolved };
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, targetPath) => {
    if (targetPath && typeof targetPath === 'string' && fs.existsSync(targetPath)) {
      shell.showItemInFolder(targetPath);
      return true;
    }
    return false;
  });

  ipcMain.handle('shell:openExternal', async (_event, url) => {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        await shell.openExternal(url);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  });

  ipcMain.handle('app:consumePendingFile', () => {
    const file = pendingFilePath;
    pendingFilePath = null;
    return file;
  });

  ipcMain.handle('app:printPdf', async (_event, data, docTitle) => {
    const tempFile = path.join(
      app.getPath('temp'),
      `jadepdf-print-${crypto.randomUUID()}.pdf`,
    );
    await fsp.writeFile(tempFile, Buffer.from(data));

    const printWin = new BrowserWindow({
      width: 980,
      height: 760,
      parent: mainWindow || undefined,
      title: `Print Preview — ${docTitle || 'Document.pdf'}`,
      autoHideMenuBar: true,
      webPreferences: {
        plugins: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    await printWin.loadFile(tempFile);
    printWin.on('closed', () => {
      fsp.unlink(tempFile).catch(() => {});
    });
    return true;
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  buildAppMenu();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
