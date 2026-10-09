// backend/stt.js
// اتصال به همان endpoint رایگان و غیررسمی گوگل که کتابخانهٔ پایتون SpeechRecognition
// (متد recognize_google) هم استفاده می‌کند. بدون نیاز به API Key یا Billing.
//
// ⚠️ این endpoint رسمی/مستندشده نیست؛ گوگل آن را برای قابلیت دیکتهٔ صوتی کروم/Chromium ساخته.
// برای استفادهٔ سبک/شخصی مشکلی ندارد (دقیقاً مشابه چیزی که در نسخهٔ پایتون این پروژه کار می‌کرد)،
// ولی سقف نرخ (rate limit) رسمی اعلام‌نشده دارد و ممکن است بدون اطلاع قبلی تغییر کند.

const https = require('https');

const HOST = 'www.google.com';
// کلید عمومی ثابتی که پروژه‌های متن‌باز (از جمله SpeechRecognition پایتون) سال‌هاست از آن استفاده می‌کنند
const PUBLIC_KEY = 'AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw';

/**
 * ارسال بافر PCM16LE خام به endpoint رایگان گوگل و دریافت متن.
 * @param {object} opts
 * @param {Buffer} opts.pcmBuffer صدای خام PCM16LE mono 16kHz
 * @param {number} [opts.sampleRate=16000]
 * @param {string} [opts.languageCode='fa-IR']
 * @returns {Promise<{transcript:string, confidence:number, raw:object}>}
 */
function recognize({ pcmBuffer, sampleRate = 16000, languageCode = 'fa-IR' }) {
  return new Promise((resolve, reject) => {
    if (!pcmBuffer || pcmBuffer.length < 320) { resolve({ transcript: '', confidence: 0, raw: null }); return; }

    const path = `/speech-api/v2/recognize?output=json&lang=${encodeURIComponent(languageCode)}&key=${PUBLIC_KEY}&maxAlternatives=1&client=chromium`;

    const req = https.request({
      hostname: HOST,
      path,
      method: 'POST',
      headers: {
        'Content-Type': `audio/l16; rate=${sampleRate}; channels=1`,
        'Content-Length': pcmBuffer.length
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP_${res.statusCode}`)); return; }
        try {
          // پاسخ چندخطی است (هر خط یک JSON)؛ آخرین خط غیرخالی معمولاً نتیجهٔ نهایی است
          const lines = data.split('\n').map((l) => l.trim()).filter(Boolean);
          let best = null;
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json?.result?.length) best = json;
            } catch { /* خطوط ناقص را نادیده بگیر */ }
          }
          const alt = best?.result?.[0]?.alternative?.[0];
          resolve({
            transcript: alt?.transcript || '',
            confidence: alt?.confidence || 0,
            raw: best
          });
        } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.write(pcmBuffer);
    req.end();
  });
}

/** آیا متن فقط از حروف/علائم لاتین تشکیل شده (یعنی احتمالاً انگلیسی درست تشخیص داده شده) */
function looksLatin(text) {
  const t = (text || '').trim();
  return !!t && /^[a-zA-Z0-9\s.,!?'"-]+$/.test(t);
}
/** آیا متن حاوی حروف فارسی/عربی است */
function looksPersian(text) {
  return /[\u0600-\u06FF]/.test(text || '');
}

/**
 * تشخیص گفتار دوزبانه (فارسی + انگلیسی) به‌صورت موازی، و انتخاب نتیجهٔ بهتر.
 * چون endpoint رایگان خودش auto-detect ندارد، هر دو زبان را همزمان می‌پرسیم و با یک
 * heuristic ساده (اعتبار + شکل ظاهری متن) بهترین را انتخاب می‌کنیم.
 * @param {object} opts
 * @param {Buffer} opts.pcmBuffer
 * @param {number} [opts.sampleRate=16000]
 * @returns {Promise<{transcript:string, confidence:number, language:'fa'|'en'}>}
 */
async function recognizeAuto({ pcmBuffer, sampleRate = 16000 }) {
  const [faResult, enResult] = await Promise.allSettled([
    recognize({ pcmBuffer, sampleRate, languageCode: 'fa-IR' }),
    recognize({ pcmBuffer, sampleRate, languageCode: 'en-US' })
  ]);
  const fa = faResult.status === 'fulfilled' ? faResult.value : { transcript: '', confidence: 0 };
  const en = enResult.status === 'fulfilled' ? enResult.value : { transcript: '', confidence: 0 };

  const faOk = fa.transcript && looksPersian(fa.transcript);
  const enOk = en.transcript && looksLatin(en.transcript);

  if (enOk && (!faOk || en.confidence > fa.confidence + 0.1)) {
    return { transcript: en.transcript, confidence: en.confidence, language: 'en' };
  }
  if (faOk) return { transcript: fa.transcript, confidence: fa.confidence, language: 'fa' };
  if (enOk) return { transcript: en.transcript, confidence: en.confidence, language: 'en' };
  // هیچ‌کدام مطمئن نبود؛ هرچه غیرخالی بود را برگردان (فارسی اولویت دارد چون زبان پیش‌فرض است)
  if (fa.transcript) return { transcript: fa.transcript, confidence: fa.confidence, language: 'fa' };
  if (en.transcript) return { transcript: en.transcript, confidence: en.confidence, language: 'en' };
  return { transcript: '', confidence: 0, language: 'fa' };
}

module.exports = { recognize, recognizeAuto };
