// backend/updater.js
// سیستم آپدیت خودکار متصل به سرور اختصاصی PHP (update.php)
// بدون وابستگی به گیت‌هاب: بررسی نسخه → دانلود با پیشرفت درصد → اجرای ستاپ جدید

const { app, BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const store = require('./store');

// آدرس پیش‌فرض سرور آپدیت
const DEFAULT_UPDATE_SERVER_URL = 'https://mirrorhub.ir/va/up/update.php';

let isDownloading = false;

function notify(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, payload);
    }
  });
}

function getUpdateServerUrl() {
  return store.get('updateServerUrl', DEFAULT_UPDATE_SERVER_URL);
}

function compareVersions(v1, v2) {
  const p1 = (v1 || '0.0.0').split('.').map((x) => parseInt(x, 10) || 0);
  const p2 = (v2 || '0.0.0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

/**
 * استعلام وضعیت نسخه از سرور PHP
 */
function checkForUpdate() {
  return new Promise((resolve, reject) => {
    const currentVersion = app.getVersion();
    const platform = process.platform === 'win32' ? 'win' : 'linux';
    const baseUrl = getUpdateServerUrl();

    if (!baseUrl || baseUrl.includes('example.com')) {
      // آدرس هنوز ست نشده است
      const res = { updateAvailable: false, notConfigured: true, currentVersion };
      notify('update-status', { state: 'none', notConfigured: true, currentVersion });
      resolve(res);
      return;
    }

    const separator = baseUrl.includes('?') ? '&' : '?';
    const checkUrl = `${baseUrl}${separator}action=check&version=${encodeURIComponent(currentVersion)}&platform=${platform}`;

    notify('update-status', { state: 'checking' });

    const client = checkUrl.startsWith('https:') ? https : http;
    const req = client.get(checkUrl, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        const err = new Error(`HTTP_${res.statusCode}`);
        notify('update-status', { state: 'error', message: err.message });
        reject(err);
        return;
      }

      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          const updateAvailable = !!info.updateAvailable;

          if (updateAvailable && info.downloadUrl) {
            notify('update-status', {
              state: 'available',
              latestVersion: info.latestVersion,
              currentVersion,
              downloadUrl: info.downloadUrl,
              releaseNotes: info.releaseNotes || '',
              mandatory: !!info.mandatory
            });
            // دانلود خودکار
            downloadAndInstall(info.downloadUrl, info.latestVersion).catch((err) => {
              console.error('[UPDATER DOWNLOAD ERROR]', err);
            });
          } else {
            notify('update-status', { state: 'none', currentVersion });
          }

          resolve({ ...info, updateAvailable, currentVersion });
        } catch (err) {
          notify('update-status', { state: 'error', message: 'پاسخ سرور نامعتبر است' });
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      notify('update-status', { state: 'error', message: err.message });
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      notify('update-status', { state: 'error', message: 'مهلت پاسخ سرور تمام شد (Timeout)' });
      reject(new Error('TIMEOUT'));
    });
  });
}

/**
 * دانلود فایل نصبی جدید همراه با دنبال‌کردن Redirectها و ارسال درصد پیشرفت به UI
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const client = url.startsWith('https:') ? https : http;

    const request = client.get(url, (response) => {
      // پشتیبانی از Redirect 301 / 302
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        downloadFile(response.headers.location, destPath, onProgress).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let receivedBytes = 0;

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0 && typeof onProgress === 'function') {
          const percent = Math.min(100, (receivedBytes / totalBytes) * 100);
          onProgress(percent);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * دانلود و اجرای فایل ستاپ
 */
async function downloadAndInstall(downloadUrl, latestVersion) {
  if (isDownloading) return;
  isDownloading = true;

  try {
    notify('update-status', { state: 'downloading', percent: 0, latestVersion });

    const ext = path.extname(new URL(downloadUrl).pathname) || (process.platform === 'win32' ? '.exe' : '.deb');
    const tempFile = path.join(os.tmpdir(), `voice-assistant-setup-${latestVersion}${ext}`);

    await downloadFile(downloadUrl, tempFile, (percent) => {
      notify('update-status', { state: 'downloading', percent: Math.round(percent), latestVersion });
    });

    notify('update-status', { state: 'ready', latestVersion });

    // اجرای خودکار فایل نصب
    setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn(tempFile, ['--updated'], { detached: true, stdio: 'ignore' }).unref();
        } else {
          // در لینوکس پکیج باز می‌شود
          spawn('xdg-open', [tempFile], { detached: true, stdio: 'ignore' }).unref();
        }
        setTimeout(() => app.quit(), 800);
      } catch (e) {
        console.error('[INSTALL LAUNCH ERROR]', e);
      }
    }, 1500);
  } catch (err) {
    notify('update-status', { state: 'error', message: 'خطا در دریافت فایل آپدیت: ' + err.message });
  } finally {
    isDownloading = false;
  }
}

function init({ auto = true } = {}) {
  if (auto) {
    setTimeout(() => checkForUpdate().catch(() => {}), 4000);
    setInterval(() => checkForUpdate().catch(() => {}), 4 * 60 * 60 * 1000);
  }
}

function checkNow() {
  return checkForUpdate();
}

module.exports = { init, checkNow, setServerUrl: (url) => store.set('updateServerUrl', url) };
