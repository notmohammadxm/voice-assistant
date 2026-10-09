const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  hideToTray: () => ipcRenderer.send('window-hide-to-tray'),
  quit: () => ipcRenderer.send('window-quit'),
  onCloseRequest: (cb) => ipcRenderer.on('request-close-confirmation', () => cb()),
  getSettings: () => ipcRenderer.invoke('get-desktop-settings'),
  setQuitWithoutPrompt: (enabled) => ipcRenderer.send('set-quit-without-prompt', !!enabled),
  setStartWithWindows: (enabled) => ipcRenderer.invoke('set-start-with-windows', !!enabled),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});

// ───────────── دستیار صوتی (بک‌اند) ─────────────
contextBridge.exposeInMainWorld('assistant', {
  startListening: () => ipcRenderer.send('voice-start'),
  sendAudioChunk: (arrayBuffer) => ipcRenderer.send('voice-audio-chunk', arrayBuffer),
  stopListening: () => ipcRenderer.send('voice-stop'),
  confirm: (accepted) => ipcRenderer.send('voice-confirm', accepted),
  onState: (cb) => ipcRenderer.on('assistant-state', (_, data) => cb(data)),
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath)
});

// ───────────── تنظیمات امن (جایگزین localStorage) ─────────────
contextBridge.exposeInMainWorld('secureSettings', {
  getAll: () => ipcRenderer.invoke('settings-get-all'),
  set: (key, value) => ipcRenderer.invoke('settings-set', key, value),
  save: (partial) => ipcRenderer.invoke('settings-save', partial),
  notifyUpdated: () => ipcRenderer.send('settings-updated')
});

// ───────────── دستورات قابل‌ویرایش ─────────────
contextBridge.exposeInMainWorld('commandsApi', {
  getAll: () => ipcRenderer.invoke('commands-get-all'),
  saveAll: (list) => ipcRenderer.invoke('commands-save-all', list)
});

// ───────────── آپدیت ─────────────
contextBridge.exposeInMainWorld('updaterApi', {
  checkNow: () => ipcRenderer.invoke('check-for-update'),
  onStatus: (cb) => ipcRenderer.on('update-status', (_, data) => cb(data))
});

// ───────────── دیباگ Piper TTS ─────────────
contextBridge.exposeInMainWorld('ttsDebug', {
  diagnose: () => ipcRenderer.invoke('tts-diagnose'),
  onWarning: (cb) => ipcRenderer.on('tts-warning', (_, data) => cb(data))
});
