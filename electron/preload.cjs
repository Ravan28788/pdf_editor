const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openFiles: (options) => ipcRenderer.invoke('dialog:openFiles', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  saveMultipleToFolder: (options) =>
    ipcRenderer.invoke('dialog:saveMultipleToFolder', options),
  readFileByPath: (filePath) => ipcRenderer.invoke('file:readPath', filePath),
  writeFileByPath: (filePath, data) =>
    ipcRenderer.invoke('file:writePath', filePath, data),
  showItemInFolder: (targetPath) =>
    ipcRenderer.invoke('shell:showItemInFolder', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  consumePendingFile: () => ipcRenderer.invoke('app:consumePendingFile'),
  printPdf: (data, title) => ipcRenderer.invoke('app:printPdf', data, title),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file && typeof file.path === 'string' ? file.path : '';
    }
  },
  onOpenFile: (callback) => {
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on('app:open-file', listener);
    return () => ipcRenderer.removeListener('app:open-file', listener);
  },
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
