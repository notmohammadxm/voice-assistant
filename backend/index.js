// backend/index.js
// نقطهٔ ورود بک‌اند: یک Session که صدای خام از renderer می‌گیرد، با VAD سکوت را تشخیص می‌دهد،
// بعد از سکوت بافر را (هم‌زمان با پخش یک فیلر صوتی کوتاه) به STT دوزبانه می‌فرستد،
// جمله را با matcher تطبیق می‌دهد، اکشن را اجرا می‌کند و پاسخ را با Piper TTS پخش می‌کند.

const { VAD } = require('./vad');
const stt = require('./stt');
const tts = require('./tts');
const filler = require('./filler');
const matcher = require('./commands/matcher');
const executor = require('./commands/executor');
const store = require('./store');

const SAMPLE_RATE = 16000;

class AssistantSession {
  /** @param {(state:string, payload?:object)=>void} onState callback برای اطلاع UI از تغییر state اورب */
  constructor(onState) {
    this.onState = onState || (() => {});
    this.chunks = [];
    this._pendingConfirm = null;
    this.lastReply = '';     // برای دستور «دوباره بگو»
    this.timers = [];        // تایمرهای فعال {id, label, handle}
    this.vad = new VAD({
      sampleRate: SAMPLE_RATE,
      silenceMs: store.get('silenceMs', 2000),
      energyThreshold: store.get('vadThreshold', 0.015),
      onSpeechStart: () => this.onState('listen'),
      onSilence: () => this._handleSilence()
    });
  }

  updateSettings() {
    this.vad.setSilenceMs(store.get('silenceMs', 2000));
    this.vad.setThreshold(store.get('vadThreshold', 0.015));
  }

  start() {
    this.chunks = [];
    this.preSpeechChunks = [];
    this._hasSpoken = false;
    this.vad.reset();
    this.onState('listen');
  }

  pushAudio(pcmChunk) {
    if (!this._hasSpoken) {
      this.preSpeechChunks.push(pcmChunk);
      if (this.preSpeechChunks.length > 5) this.preSpeechChunks.shift(); // ~1.2s pre-buffer
    } else {
      this.chunks.push(pcmChunk);
    }
    const { hasVoice } = this.vad.push(pcmChunk);
    if (hasVoice && !this._hasSpoken) {
      this._hasSpoken = true;
      this.chunks = [...this.preSpeechChunks, pcmChunk];
      this.preSpeechChunks = [];
    }
  }

  async stopManually() {
    await this._handleSilence();
  }

  async _handleSilence() {
    if (!this._hasSpoken || !this.chunks.length) {
      this.chunks = [];
      this.preSpeechChunks = [];
      this._hasSpoken = false;
      this.vad.reset();
      this.onState('idle');
      return;
    }
    const pcmBuffer = Buffer.concat(this.chunks);
    this.chunks = [];
    this.preSpeechChunks = [];
    this._hasSpoken = false;

    // فیلر صوتی («یک لحظه صبر کن») فقط یک‌بار همین‌جا پخش می‌شود، موازی با STT که کمی طول می‌کشد
    const fillerPath = filler.getFillerPath();
    this.onState('thinking', fillerPath ? { fillerAudio: fillerPath } : {});

    let transcript = '', language = 'fa';
    try {
      const result = await stt.recognizeAuto({ pcmBuffer, sampleRate: SAMPLE_RATE });
      transcript = result.transcript;
      language = result.language;
    } catch (err) {
      this.onState('error', { message: 'خطا در تشخیص گفتار: ' + err.message });
      return;
    }

    if (!transcript) {
      this.onState('error', { message: 'چیزی شنیده نشد' });
      return;
    }

    const matched = matcher.match(transcript);
    if (!matched) {
      this.onState('error', { message: 'دستور فهمیده نشد', transcript });
      return;
    }

    // «دوباره بگو»: خارج از executor عادی، چون به حافظهٔ نوبت قبلی نیاز دارد
    if (matched.command.action === 'meta.repeat') {
      if (!this.lastReply) { this.onState('error', { message: 'هنوز چیزی نگفته‌ام', transcript }); return; }
      await this._speak(this.lastReply, transcript, true);
      return;
    }

    const result = await executor.execute(matched, { session: this });
    if (result.needsConfirm) {
      this._pendingConfirm = result.pending;
      this.onState('thinking', { needsConfirm: true, reply: result.reply, transcript });
      return;
    }

    await this._speak(result.reply, transcript, result.ok, { language });
  }

  async confirmPending(accepted) {
    if (!this._pendingConfirm) return;
    const pending = this._pendingConfirm;
    this._pendingConfirm = null;
    if (!accepted) { this.onState('idle'); return; }
    const forced = { ...pending.command, confirm: false };
    const result = await executor.execute({ command: forced, params: pending.params }, { session: this });
    await this._speak(result.reply, '', result.ok);
  }

  /** پخش یک متن دلخواه بدون اینکه کاربر چیزی گفته باشد (مثلاً پایان تایمر) */
  async announce(text) {
    await this._speak(text, '', true);
  }

  /** ثبت یک تایمر؛ بعد از گذشت ms، اعلام صوتی می‌شود */
  scheduleTimer(ms, label) {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const handle = setTimeout(() => {
      this.timers = this.timers.filter((t) => t.id !== id);
      this.announce(`تایمر ${label || ''} تمام شد`.trim());
    }, ms);
    this.timers.push({ id, label, handle });
    return id;
  }

  async _speak(replyText, transcript, ok, extra = {}) {
    this.lastReply = replyText;
    this.onState('speak', { reply: replyText, transcript });
    try {
      const voice = store.get('ttsVoice', 'amir-medium');
      const wavPath = await tts.synthesize(replyText, { voice });
      this.onState(ok ? 'success' : 'error', { reply: replyText, transcript, audioPath: wavPath, ...extra });
    } catch (err) {
      console.error('[TTS ERROR]', err.message, tts.diagnose(store.get('ttsVoice', 'amir-medium')));
      const hint = err.message === 'PIPER_NOT_INSTALLED'
        ? 'فایل‌های Piper (باینری یا مدل) پیدا نشد — به assets/piper/README.md مراجعه کنید'
        : 'اجرای Piper با خطا مواجه شد — جزئیات در ترمینال';
      this.onState(ok ? 'success' : 'error', { reply: replyText, transcript, ttsError: err.message, ttsHint: hint, ...extra });
    }
    // بعد از پخش TTS، state idle فرستاده می‌شه تا renderer بداند شروع به گوش دادن مجدد کند
    setTimeout(() => { this.vad.reset(); this.onState('idle'); }, 800);
  }
}

module.exports = { AssistantSession };
