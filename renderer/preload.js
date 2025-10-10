const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Scan operations
  startScan: (config) => ipcRenderer.invoke('start-scan', config),
  stopScan: () => ipcRenderer.invoke('stop-scan'),
  
  // File operations
  selectStoreMappingFile: () => ipcRenderer.invoke('select-store-mapping-file'),
  selectItemListFile: () => ipcRenderer.invoke('select-item-list-file'),
  selectExportLocation: () => ipcRenderer.invoke('select-export-location'),
  
  // Results
  exportResults: (exportPath) => ipcRenderer.invoke('export-results', exportPath),
  
  // Config
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getScreenDimensions: () => ipcRenderer.invoke('get-screen-dimensions'),
  
  // Updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  restartAndInstall: () => ipcRenderer.invoke('restart-and-install'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Database management
  getDatabaseStats: () => ipcRenderer.invoke('get-database-stats'),
  getAllSessions: () => ipcRenderer.invoke('get-all-sessions'),
  deleteSession: (sessionId) => ipcRenderer.invoke('delete-session', sessionId),
  cleanupOldSessions: (daysToKeep) => ipcRenderer.invoke('cleanup-old-sessions', daysToKeep),
  keepLatestScans: (count) => ipcRenderer.invoke('keep-latest-scans', count),
  
  // Event listeners - these return a cleanup function
  onScanProgress: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('scan-progress', subscription);
    return () => ipcRenderer.removeListener('scan-progress', subscription);
  },
  
  onScanResult: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('scan-result', subscription);
    return () => ipcRenderer.removeListener('scan-result', subscription);
  },
  
  onUpdaterMessage: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('updater-message', subscription);
    return () => ipcRenderer.removeListener('updater-message', subscription);
  },
  
  onUpdaterProgress: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('updater-progress', subscription);
    return () => ipcRenderer.removeListener('updater-progress', subscription);
  },
  
  // Cleanup - remove all listeners for a specific channel
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});