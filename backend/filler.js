// backend/filler.js
// چون تشخیص دوزبانه (fa+en موازی) و بعد اجرای دستور کمی زمان می‌برد، یک پیام کوتاه صوتی
// («یک لحظه صبر کن...») حین حالت thinking پخش می‌شود تا کاربر منتظر سکوت نماند.
// برای اینکه این پیام خودش باعث تاخیر نشود، فایل‌های صوتی‌اش یک‌بار از قبل (lazy، در اولین استفاده)
// با Piper ساخته و روی دیسک کش می‌شوند؛ دفعات بعد فقط از کش خوانده می‌شود (فوری).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const tts = require('./tts');

const PHRASES = [
  'یک لحظه صبر کن',
  'دارم بررسی می‌کنم',
  'صبر کن ببینم'
];

function cacheDir() {
  const dir = path.join(app.getPath('userData'), 'filler-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cachedPath(index) {
  return path.join(cacheDir(), `filler-${index}.wav`);
}

let warmedUp = false;

/** در صورت نیاز فایل‌های فیلر را از قبل می‌سازد (یک‌بار در کل عمر برنامه) */
async function warmUp(voice = 'amir-medium') {
  if (warmedUp || !tts.isReady(voice)) return;
  warmedUp = true;
  for (let i = 0; i < PHRASES.length; i++) {
    const dest = cachedPath(i);
    if (fs.existsSync(dest)) continue;
    try {
      const tmp = await tts.synthesize(PHRASES[i], { voice });
      fs.copyFileSync(tmp, dest);
    } catch { /* اگر ساخته نشد، همان لحظهٔ استفاده دوباره تلاش می‌شود */ }
  }
}

/** یک فایل فیلر تصادفی برمی‌گرداند؛ اگر کش آماده نبود null (یعنی چیزی پخش نشود، بدون تاخیر) */
function getFillerPath() {
  const idx = Math.floor(Math.random() * PHRASES.length);
  const p = cachedPath(idx);
  return fs.existsSync(p) ? p : null;
}

module.exports = { warmUp, getFillerPath };
