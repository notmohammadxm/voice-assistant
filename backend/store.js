// backend/store.js
// ذخیره‌سازی امن تنظیمات کاربر روی دیسک به‌جای localStorage.
// از safeStorage خود Electron (DPAPI روی ویندوز) برای رمزنگاری در حالت rest استفاده می‌شود.
// اگر safeStorage در دسترس نبود (مثلاً سیستم بدون کیچین)، به‌صورت امن به حالت plain-json سقوط می‌کند.

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const FILE_NAME = 'settings.secure';
const FILE_PATH = () => path.join(app.getPath('userData'), FILE_NAME);
const TMP_PATH = () => FILE_PATH() + '.tmp';

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function readRaw() {
  const p = FILE_PATH();
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  if (buf.length === 0) return null;
  try {
    if (canEncrypt()) {
      const decrypted = safeStorage.decryptString(buf);
      return JSON.parse(decrypted);
    }
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    // فایل خراب/ناسازگار است؛ به‌جای کرش کردن برنامه، یک بکاپ می‌گیریم و خالی برمی‌گردانیم
    try { fs.copyFileSync(p, p + '.corrupt-' + Date.now()); } catch {}
    return null;
  }
}

function writeRaw(data) {
  const json = JSON.stringify(data);
  const out = canEncrypt() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  // نوشتن اتمیک: اول روی فایل موقت بنویس بعد rename کن تا در صورت قطع برق/کرش فایل خراب نشود
  fs.writeFileSync(TMP_PATH(), out);
  fs.renameSync(TMP_PATH(), FILE_PATH());
}

let cache = null;

function load() {
  if (cache) return cache;
  cache = readRaw() || {};
  return cache;
}

function save(partialOrFull, { merge = true } = {}) {
  const current = load();
  cache = merge ? deepMerge(current, partialOrFull) : partialOrFull;
  writeRaw(cache);
  return cache;
}

function get(key, fallback) {
  const data = load();
  if (key === undefined) return data;
  return key in data ? data[key] : fallback;
}

function set(key, value) {
  return save({ [key]: value });
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const k of Object.keys(source || {})) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && target[k] && typeof target[k] === 'object') {
      out[k] = deepMerge(target[k], sv);
    } else {
      out[k] = sv;
    }
  }
  return out;
}

module.exports = { load, save, get, set };
