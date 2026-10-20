const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopAPI', {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onCloseConfirmation: (callback) => {
    const listener = (_event, details) => callback(details)
    ipcRenderer.on('app:close-confirmation', listener)
    return () => ipcRenderer.removeListener('app:close-confirmation', listener)
  },
  respondToClose: (decision) => ipcRenderer.send('app:close-decision', decision),
  exitApplication: () => ipcRenderer.send('app:decline-disclaimer'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  recordUsageLaunch: () => ipcRenderer.invoke('usage:record-launch'),
  getUsageChart: () => ipcRenderer.invoke('usage:get-chart'),
  openReleasePage: () => ipcRenderer.invoke('updates:open-release'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  },
  openProject: () => ipcRenderer.invoke('app:open-project'),
  saveDiagnostics: (payload) => ipcRenderer.invoke('diagnostics:save', payload),
  getBackendUrl: () => ipcRenderer.invoke('app:get-backend-url'),
  getBackendToken: () => ipcRenderer.invoke('app:get-backend-token'),
  loadCredentials: () => ipcRenderer.invoke('credentials:load'),
  saveCredentials: (payload) => ipcRenderer.invoke('credentials:save', payload),
  clearCredentials: () => ipcRenderer.invoke('credentials:clear')
})
