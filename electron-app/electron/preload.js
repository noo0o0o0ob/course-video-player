const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopAPI', {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openProject: () => ipcRenderer.invoke('app:open-project'),
  saveDiagnostics: (payload) => ipcRenderer.invoke('diagnostics:save', payload),
  getBackendUrl: () => ipcRenderer.invoke('app:get-backend-url'),
  getBackendToken: () => ipcRenderer.invoke('app:get-backend-token'),
  loadCredentials: () => ipcRenderer.invoke('credentials:load'),
  saveCredentials: (payload) => ipcRenderer.invoke('credentials:save', payload),
  clearCredentials: () => ipcRenderer.invoke('credentials:clear')
})
