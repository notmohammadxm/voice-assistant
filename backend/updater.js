// backend/updater.js
// سیستم آپدیت خودکار متصل به سرور اختصاصی PHP (update.php)
// پشتیبانی کامل از ۳ پلتفرم: Windows (.exe), Linux Debian (.deb), Linux AppImage (.AppImage)
// دانلود ایمن با هندلینگ ریدایرکت، استریم، نمایش درصد پیشرفت، تایم‌اوت و اجرای نصب

const { app, BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const store = require('./store');

// آدرس پیش‌فرض سرور آپدیت (پشتیبانی از پروتکل و در صورت نیاز فال‌بک)
const DEFAULT_UPDATE_SERVER_URL = 'http://mirrorhub.ir/va/up/update.php';

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

function getTargetInfo() {
  if (process.platform === 'win32') {
    return {
      platform: 'win',
      target: 'win',
      format: 'exe',
      ext: '.exe'
    };
  }
  if (process.platform === 'linux') {
    // در صورت اجرا در قالب AppImage، متغیر محیطی APPIMAGE ست شده است
    if (process.env.APPIMAGE) {
      return {
        platform: 'linux',
        target: 'appimage',
        format: 'appimage',
        ext: '.AppImage'
      };
    }
    return {
      platform: 'linux',
      target: 'deb',
      format: 'deb',
      ext: '.deb'
    };
  }
  return {
    platform: process.platform,
    target: process.platform,
    format: 'zip',
    ext: '.zip'
  };
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
 * دریافت پاسخ متنی/JSON با پشتیبانی از ریدایرکت، هدرهای استاندارد و تایم‌اوت
 */
function fetchText(requestUrl, { timeout = 12000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let currentUrl;
    try {
      currentUrl = new URL(requestUrl);
    } catch (e) {
      return reject(new Error('آدرس نامعتبر است: ' + requestUrl));
    }

    const client = currentUrl.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': `VoiceAssistant/${app.getVersion()} (${process.platform}; ${process.arch})`,
      'Accept': 'application/json, text/plain, */*'
    };

    const req = client.get(currentUrl.href, { headers, timeout }, (res) => {
      // پشتیبانی از Redirect (301, 302, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // آزادسازی سوکت
        if (maxRedirects <= 0) {
          return reject(new Error('ریدایرکت‌های بیش از حد مجاز'));
        }
        const nextUrl = new URL(res.headers.location, currentUrl.href).href;
        return fetchText(nextUrl, { timeout, maxRedirects: maxRedirects - 1 })
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP_${res.statusCode}`));
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('مهلت پاسخ سرور به پایان رسید (Timeout)'));
    });
  });
}

/**
 * استعلام نسخه از سرور با فال‌بک خودکار پروتکل در صورت مشکل شبکه/SSL
 */
async function queryServerWithFallback(baseUrl, currentVersion, targetInfo) {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const queryStr = `action=check&version=${encodeURIComponent(currentVersion)}&platform=${encodeURIComponent(targetInfo.target)}&format=${encodeURIComponent(targetInfo.format)}`;
  const primaryUrl = `${baseUrl}${separator}${queryStr}`;

  try {
    const raw = await fetchText(primaryUrl, { timeout: 10000 });
    return JSON.parse(raw);
  } catch (err) {
    // اگر با HTTPS خطا خورد (مثلاً سرور SSL ندارد)، تلاش مجدد با HTTP
    if (primaryUrl.startsWith('https://')) {
      const fallbackUrl = primaryUrl.replace(/^https:\/\//i, 'http://');
      try {
        const raw = await fetchText(fallbackUrl, { timeout: 10000 });
        return JSON.parse(raw);
      } catch {}
    } else if (primaryUrl.startsWith('http://')) {
      const fallbackUrl = primaryUrl.replace(/^http:\/\//i, 'https://');
      try {
        const raw = await fetchText(fallbackUrl, { timeout: 10000 });
        return JSON.parse(raw);
      } catch {}
    }
    throw err;
  }
}

/**
 * استعلام وضعیت نسخه از سرور PHP
 */
async function checkForUpdate() {
  const currentVersion = app.getVersion();
  const targetInfo = getTargetInfo();
  const baseUrl = getUpdateServerUrl();

  if (!baseUrl || baseUrl.includes('example.com')) {
    const res = { updateAvailable: false, notConfigured: true, currentVersion };
    notify('update-status', { state: 'none', notConfigured: true, currentVersion });
    return res;
  }

  notify('update-status', { state: 'checking' });

  try {
    const info = await queryServerWithFallback(baseUrl, currentVersion, targetInfo);
    const updateAvailable = !!info.updateAvailable;

    if (updateAvailable && info.downloadUrl) {
      notify('update-status', {
        state: 'available',
        latestVersion: info.latestVersion,
        currentVersion,
        downloadUrl: info.downloadUrl,
        releaseNotes: info.releaseNotes || '',
        mandatory: !!info.mandatory,
        target: targetInfo.target
      });

      // شروع دانلود خودکار بسته جدید
      downloadAndInstall(info.downloadUrl, info.latestVersion).catch((err) => {
        console.error('[UPDATER DOWNLOAD ERROR]', err);
      });
    } else {
      notify('update-status', { state: 'none', currentVersion });
    }

    return { ...info, updateAvailable, currentVersion };
  } catch (err) {
    console.error('[UPDATER CHECK ERROR]', err);
    notify('update-status', { state: 'error', message: 'خطا در ارتباط با سرور: ' + err.message });
    throw err;
  }
}

/**
 * دانلود فایل نصبی جدید با استریم امن، دنبال‌کردن ریدایرکت‌ها، کنترل هدرها و درصد پیشرفت
 */
function downloadFile(fileUrl, destPath, onProgress, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let currentUrl;
    try {
      currentUrl = new URL(fileUrl);
    } catch (e) {
      return reject(new Error('آدرس دانلود نامعتبر است: ' + fileUrl));
    }

    const client = currentUrl.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': `VoiceAssistant/${app.getVersion()} (${process.platform}; ${process.arch})`,
      'Accept': '*/*'
    };

    const req = client.get(currentUrl.href, { headers, timeout: 30000 }, (res) => {
      // ریدایرکت (301, 302, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) {
          return reject(new Error('ریدایرکت‌های بیش از حد در زمان دانلود'));
        }
        const nextUrl = new URL(res.headers.location, currentUrl.href).href;
        return downloadFile(nextUrl, destPath, onProgress, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`کد خطای سرور در دانلود: HTTP ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let receivedBytes = 0;

      // ساخت فایل تنها پس از اطمینان از پاسخ 200
      const file = fs.createWriteStream(destPath);

      file.on('error', (err) => {
        file.close(() => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (typeof onProgress === 'function') {
          if (totalBytes > 0) {
            const percent = Math.min(100, (receivedBytes / totalBytes) * 100);
            onProgress(percent, receivedBytes, totalBytes);
          } else {
            onProgress(-1, receivedBytes, 0);
          }
        }
      });

      res.on('error', (err) => {
        file.close(() => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close((err) => {
          if (err) return reject(err);
          resolve(destPath);
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ارتباط با سرور دانلود قطع شد (Timeout)'));
    });
  });
}

/**
 * دانلود و اجرای فایل ستاپ متناسب با سیستم‌عامل
 */
async function downloadAndInstall(downloadUrl, latestVersion) {
  if (isDownloading) return;
  isDownloading = true;

  try {
    notify('update-status', { state: 'downloading', percent: 0, latestVersion });

    const targetInfo = getTargetInfo();
    let ext = targetInfo.ext;

    try {
      const urlPath = new URL(downloadUrl).pathname;
      const parsedExt = path.extname(urlPath);
      if (parsedExt && ['.exe', '.deb', '.appimage'].includes(parsedExt.toLowerCase())) {
        ext = parsedExt;
      }
    } catch {}

    const tempFile = path.join(os.tmpdir(), `voice-assistant-setup-${latestVersion}${ext}`);

    // در صورت وجود فایل قبلی، پاک شود
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}

    await downloadFile(downloadUrl, tempFile, (percent) => {
      const displayPct = percent >= 0 ? Math.round(percent) : undefined;
      notify('update-status', { state: 'downloading', percent: displayPct, latestVersion });
    });

    notify('update-status', { state: 'ready', latestVersion });

    // اجرای خودکار فایل نصب بر اساس پلتفرم
    setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn(tempFile, ['--updated'], { detached: true, stdio: 'ignore' }).unref();
        } else if (targetInfo.target === 'appimage') {
          // برای AppImage دسترسی اجرایی تنظیم شود
          try {
            fs.chmodSync(tempFile, 0o755);
          } catch (e) {
            console.warn('[UPDATER] chmod failed:', e);
          }
          spawn(tempFile, [], { detached: true, stdio: 'ignore' }).unref();
        } else {
          // پکیج deb در لینوکس
          spawn('xdg-open', [tempFile], { detached: true, stdio: 'ignore' }).unref();
        }

        setTimeout(() => app.quit(), 1000);
      } catch (e) {
        console.error('[INSTALL LAUNCH ERROR]', e);
        notify('update-status', { state: 'error', message: 'خطا در اجرای فایل نصب: ' + e.message });
      }
    }, 1500);
  } catch (err) {
    console.error('[DOWNLOAD AND INSTALL ERROR]', err);
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

module.exports = {
  init,
  checkNow,
  setServerUrl: (url) => store.set('updateServerUrl', url),
  getTargetInfo
};
