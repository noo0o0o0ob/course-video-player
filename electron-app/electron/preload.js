const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopAPI', {
  getBackendUrl: () => ipcRenderer.invoke('app:get-backend-url'),
  getBackendToken: () => ipcRenderer.invoke('app:get-backend-token'),
  loadCredentials: () => ipcRenderer.invoke('credentials:load'),
  saveCredentials: (payload) => ipcRenderer.invoke('credentials:save', payload),
  clearCredentials: () => ipcRenderer.invoke('credentials:clear')
})
