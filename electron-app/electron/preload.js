const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopAPI', {
  getBackendUrl: () => ipcRenderer.invoke('app:get-backend-url'),
  loadCredentials: () => ipcRenderer.invoke('credentials:load'),
  saveCredentials: (payload) => ipcRenderer.invoke('credentials:save', payload),
  clearCredentials: () => ipcRenderer.invoke('credentials:clear')
})
