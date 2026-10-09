// backend/vad.js
// تشخیص سکوت روی استریم PCM 16-bit mono.
// هدف: وقتی به‌مدت N میلی‌ثانیه (قابل تنظیم در Settings) انرژی صدا زیر آستانه بود، سیگنال "silence" بزند
// تا STT بداند دیگر باید نتیجه را نهایی/ارسال کند.

class VAD {
  /**
   * @param {object} opts
   * @param {number} opts.sampleRate نرخ نمونه‌برداری ورودی (پیش‌فرض 16000)
   * @param {number} opts.silenceMs مدت سکوت لازم برای پایان گفتار، پیش‌فرض 2000ms (قابل تنظیم کاربر)
   * @param {number} opts.energyThreshold آستانهٔ RMS برای تشخیص «صدا دارد» (۰ تا ۱)
   * @param {function} opts.onSilence callback هنگام رسیدن به آستانهٔ سکوت
   * @param {function} opts.onSpeechStart callback هنگام شروع دوبارهٔ صحبت بعد سکوت کوتاه
   */
  constructor({ sampleRate = 16000, silenceMs = 2000, energyThreshold = 0.015, onSilence, onSpeechStart } = {}) {
    this.sampleRate = sampleRate;
    this.silenceMs = silenceMs;
    this.energyThreshold = energyThreshold;
    this.onSilence = onSilence || (() => {});
    this.onSpeechStart = onSpeechStart || (() => {});
    this._lastVoiceTs = null;
    this._speaking = false;
    this._silenceTimer = null;
    this._fired = false;
  }

  setSilenceMs(ms) { this.silenceMs = Math.max(300, Number(ms) || 2000); }
  setThreshold(v) { this.energyThreshold = Math.max(0, Math.min(1, Number(v) || 0.015)); }

  reset() {
    this._lastVoiceTs = null;
    this._speaking = false;
    this._fired = false;
    if (this._silenceTimer) clearTimeout(this._silenceTimer);
    this._silenceTimer = null;
  }

  /** @param {Int16Array|Buffer} chunk یک بلوک PCM16LE */
  push(chunk) {
    const samples = chunk instanceof Int16Array ? chunk : new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    const hasVoice = rms > this.energyThreshold;

    if (hasVoice) {
      if (!this._speaking) { this._speaking = true; this._fired = false; this.onSpeechStart(); }
      this._lastVoiceTs = Date.now();
      if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    } else if (this._speaking && !this._silenceTimer) {
      this._armSilenceTimer();
    }
    return { rms, hasVoice };
  }

  _armSilenceTimer() {
    this._silenceTimer = setTimeout(() => {
      if (this._speaking && !this._fired) {
        this._fired = true;
        this._speaking = false;
        this.onSilence();
      }
    }, this.silenceMs);
  }
}

module.exports = { VAD };
