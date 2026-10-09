const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./backend/store');
const { AssistantSession } = require('./backend');
const updater = require('./backend/updater');
const commandsMatcher = require('./backend/commands/matcher');

const ICON = fs.existsSync(path.join(__dirname, 'assets', 'logo.png'))
  ? path.join(__dirname, 'assets', 'logo.png')
  : path.join(__dirname, 'assets', 'tray.png');
let win = null, tray = null, quitting = false, quitWithoutPrompt = false;
let session = null;

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => show());

function createWindow() {
  win = new BrowserWindow({
    width: 400, height: 600,
    useContentSize: true,
    frame: false, resizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#050914', show: false, icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: !app.isPackaged
    }
  });
  win.setMenu(null);

  // باز کردن تمام لینک‌ها و پنجره‌های خارجی در مرورگر پیش‌فرض سیستم (کروم، اج، و ...)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (quitting || quitWithoutPrompt) return;
    e.preventDefault();
    win.webContents.send('request-close-confirmation');
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('Voice Assistant');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'نمایش دستیار', click: show },
    { type: 'separator' },
    { label: 'خروج', click: quit }
  ]));
  tray.on('click', show);
}

function show() {
  if (!win) return;
  win.setSkipTaskbar(false);
  win.show();
  win.focus();
}

function quit() {
  quitting = true;
  app.quit();
}

ipcMain.on('window-hide-to-tray', () => { win?.hide(); win?.setSkipTaskbar(true); });
ipcMain.on('window-quit', quit);
ipcMain.on('set-quit-without-prompt', (_, enabled) => { quitWithoutPrompt = !!enabled; });
ipcMain.handle('get-desktop-settings', () => ({
  openAtLogin: process.platform === 'win32' ? app.getLoginItemSettings().openAtLogin : false,
  quitWithoutPrompt
}));
ipcMain.handle('set-start-with-windows', (_, enabled) => {
  if (process.platform !== 'win32') return false;
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin === !!enabled;
  } catch { return false; }
});

// ───────────── بک‌اند صوتی (STT/VAD/دستورات/TTS) ─────────────

function sendState(state, payload) {
  win?.webContents.send('assistant-state', { state, payload: payload || {} });
}

function ensureSession() {
  if (!session) session = new AssistantSession(sendState);
  return session;
}

ipcMain.on('voice-start', () => ensureSession().start());
ipcMain.on('voice-audio-chunk', (_, buf) => ensureSession().pushAudio(Buffer.from(buf)));
ipcMain.on('voice-stop', () => ensureSession().stopManually());
ipcMain.on('voice-confirm', (_, accepted) => ensureSession().confirmPending(!!accepted));

// تنظیمات امن (جایگزین localStorage)
ipcMain.handle('settings-get-all', () => store.load());
ipcMain.handle('settings-set', (_, key, value) => store.set(key, value));
ipcMain.handle('settings-save', (_, partial) => store.save(partial));
ipcMain.on('settings-updated', () => { session?.updateSettings(); });

// دستورات قابل ویرایش (برای بعداً - افزودن/ویرایش دستور از داخل برنامه)
ipcMain.handle('commands-get-all', () => commandsMatcher.loadCommands());
ipcMain.handle('commands-save-all', (_, list) => { commandsMatcher.saveCommands(list); return true; });

// باز کردن لینک در مرورگر پیش‌فرض سیستم
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// پخش فایل صوتی TTS تولیدشده: چون فایل موقت روی دیسک است، یک پروتکل محلی امن برای خواندنش می‌سازیم
ipcMain.handle('read-audio-file', (_, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.toString('base64');
  } catch { return null; }
});

ipcMain.handle('check-for-update', () => updater.checkNow().catch((e) => ({ error: String(e) })));

const tts = require('./backend/tts');
const filler = require('./backend/filler');
ipcMain.handle('tts-diagnose', () => tts.diagnose(store.get('ttsVoice', 'amir-medium')));

app.whenReady().then(() => {
  createWindow();
  createTray();
  updater.init({ auto: app.isPackaged });
  // بررسی اولیهٔ Piper، تا اگر فایل‌هایش جا نیفتاده همان ابتدا در کنسول گزارش شود
  win.webContents.once('did-finish-load', () => {
    const diag = tts.diagnose(store.get('ttsVoice', 'amir-medium'));
    if (!diag.binaryExists || !diag.modelExists || !diag.configExists) {
      console.warn('[Piper TTS] فایل‌های لازم کامل نیستند:', diag);
      win.webContents.send('tts-warning', diag);
    } else {
      filler.warmUp(store.get('ttsVoice', 'amir-medium'));
    }
  });
});
app.on('window-all-closed', () => {});
