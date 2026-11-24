const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('desktop-window:minimize'),
  toggleMaximize: () => ipcRenderer.send('desktop-window:toggle-maximize'),
  close: () => ipcRenderer.send('desktop-window:close'),
  isMaximized: () => ipcRenderer.invoke('desktop-window:is-maximized'),
  onMaximizedChanged: (callback) => {
    ipcRenderer.on('desktop-window:maximized-changed', (_event, maximized) => callback(Boolean(maximized)));
  },
});
