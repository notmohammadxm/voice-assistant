(() => {
  const $ = (id) => document.getElementById(id);
  const all = (s) => document.querySelectorAll(s);
  const fa = (n) => (+n).toLocaleString('fa');
  const body = document.body;
  const storeKey = 'voice-assistant.settings.v2';

  const DEFAULTS = {
    themeMode: 'system',
    accents: { dark: 'default', light: 'default' },
    outputVolume: 68,
    inputVolume: 70,
    outputDevice: 'default',
    inputDevice: 'default',
    soundEnabled: true,
    micEnabled: true,
    quitWithoutPrompt: false,
    cursorReactive: true,
    ambientBackground: true,
    micRing: true,
    responseVisualizer: true,
    startWithWindows: false,
    shortcuts: {
      mic: 'Space', mute: 'M', orbNext: 'O', volume: 'V', help: 'H',
      settings: 'Ctrl + ,', tray: 'Ctrl + Shift + T', quit: 'Ctrl + Q'
    }
  };

  // تنظیمات اکنون در فایل JSON امن سمت main ذخیره می‌شوند (نه localStorage) تا با پاک‌شدن پروفایل از بین نروند.
  // برای شروع فوری UI بدون تاخیر، ابتدا یک اسنپ‌شات محلی (اگر از نسخهٔ قبلی باقی مانده) یا DEFAULTS استفاده می‌شود،
  // سپس به‌محض برگشت IPC با مقدار واقعی هم‌گام (hydrate) و UI رفرش می‌شود.
  const VOICE_DEFAULTS = { silenceMs: 2000, vadThreshold: 0.015, ttsVoice: 'amir-medium' };
  Object.assign(DEFAULTS, VOICE_DEFAULTS);

  const loadSettingsSync = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) || 'null');
      return {
        ...DEFAULTS,
        ...(raw || {}),
        accents: {...DEFAULTS.accents, ...(raw?.accents || {})},
        shortcuts: {...DEFAULTS.shortcuts, ...(raw?.shortcuts || {})}
      };
    } catch { return structuredClone(DEFAULTS); }
  };
  const settings = loadSettingsSync();
  const saveSettings = () => {
    localStorage.setItem(storeKey, JSON.stringify(settings)); // کش محلی سریع برای بوت بعدی
    window.secureSettings?.save(settings);                     // منبع حقیقت دائمی و امن
    window.secureSettings?.notifyUpdated();
  };
  const hydrateFromSecureStore = async () => {
    try {
      const remote = await window.secureSettings?.getAll?.();
      if (remote && Object.keys(remote).length) {
        Object.assign(settings, { ...DEFAULTS, ...remote,
          accents: {...DEFAULTS.accents, ...(remote.accents || {})},
          shortcuts: {...DEFAULTS.shortcuts, ...(remote.shortcuts || {})} });
        refreshSettingsUI(); applyTheme(); syncLegacyVolume();
        $('silenceMs') && ($('silenceMs').value = settings.silenceMs);
        $('silenceMsText') && ($('silenceMsText').textContent = (settings.silenceMs / 1000).toFixed(1) + ' ثانیه');
        $('vadThreshold') && ($('vadThreshold').value = Math.round(settings.vadThreshold * 1000));
      }
    } catch {}
  };

  const toast = $('toast');
  let tt;
  const say = (msg) => {
    clearTimeout(tt);
    toast.textContent = msg;
    if (!toast.matches(':popover-open')) toast.showPopover();
    tt = setTimeout(() => toast.hidePopover(), 2100);
  };

  const mediaTheme = window.matchMedia('(prefers-color-scheme: light)');
  const resolveTheme = () => settings.themeMode === 'system' ? (mediaTheme.matches ? 'light' : 'dark') : settings.themeMode;
  const applyTheme = () => {
    const resolved = resolveTheme();
    body.dataset.theme = resolved;
    body.dataset.themeMode = settings.themeMode;
    body.dataset.accent = settings.accents[resolved] || 'default';
    body.classList.toggle('no-cursor-reactive', !settings.cursorReactive);
    body.classList.toggle('no-ambient', !settings.ambientBackground);
  };
  mediaTheme.addEventListener?.('change', () => { if (settings.themeMode === 'system') applyTheme(); });

  // Orb states
  const STATES = [
    ['', 'آماده', 'idle'], ['listen', 'در حال شنیدن', 'listen'], ['thinking', 'در حال فکر', 'thinking'],
    ['speak', 'در حال پاسخ', 'speak'], ['success', 'انجام شد', 'success'], ['error', 'خطا', 'error']
  ];
  let s = 0;
  const STATE_KEY_TO_INDEX = Object.fromEntries(STATES.map(([, , key], i) => [key, i]));
  const applyState = (index) => {
    s = (index + STATES.length) % STATES.length;
    const [cls, label, key] = STATES[s];
    $('orb').classList.remove('listen', 'thinking', 'speak', 'success', 'error');
    if (cls) $('orb').classList.add(cls);
    $('stt').textContent = label;
    $('st').dataset.s = s;
    body.dataset.state = key;
    window.orbFx?.set(key);
  };
  const applyStateByKey = (key, label) => {
    const idx = STATE_KEY_TO_INDEX[key] ?? 0;
    applyState(idx);
    if (label) $('stt').textContent = label;
  };
  // اورب دیگر با کلیک دستی تغییر نمی‌کند؛ فقط بازتاب‌دهندهٔ state واقعی پایپ‌لاین صداست (پایین‌تر وایر می‌شود)
  applyState(0);

  // Cursor-reactive background & 3D Orb tilt
  let bgLast = 0;
  window.addEventListener('pointermove', (e) => {
    if (!settings.cursorReactive) return;
    const now = performance.now();
    if (now - bgLast < 16) return;
    bgLast = now;
    body.style.setProperty('--bg-x', `${e.clientX}px`);
    body.style.setProperty('--bg-y', `${e.clientY}px`);
    const nx = (e.clientX / innerWidth - 0.5) * 2;
    const ny = (e.clientY / innerHeight - 0.5) * 2;
    body.style.setProperty('--orb-mx', `${nx}`);
    body.style.setProperty('--orb-my', `${ny}`);
    // زاویه چرخش 3D و جابه‌جایی واکنش‌گرای اورب
    body.style.setProperty('--orb-rx', `${(-ny * 14).toFixed(1)}deg`);
    body.style.setProperty('--orb-ry', `${(nx * 14).toFixed(1)}deg`);
    body.style.setProperty('--orb-tx', `${(nx * 8).toFixed(1)}px`);
    body.style.setProperty('--orb-ty', `${(ny * 8).toFixed(1)}px`);
  });

  // Response visualizer
  const V = $('viz'), N = 30;
  const bars = Array.from({ length: N }, () => V.appendChild(document.createElement('i')));
  let amp = 0, rest = false;
  const frame = (t) => {
    requestAnimationFrame(frame);
    const on = s === 3 && settings.responseVisualizer && settings.soundEnabled;
    if (!on && rest) return;
    amp += ((on ? 1 : 0) - amp) * 0.08;
    rest = !on && amp < 0.01;
    bars.forEach((b, i) => {
      const e = Math.sin((i / (N - 1)) * Math.PI);
      const w = (Math.sin(t / 180 + i * .7) + Math.sin(t / 310 + i * 1.3)) / 4 + .5;
      b.style.transform = `scaleY(${.06 + .06 * e + amp * e * w * .88})`;
    });
  };
  requestAnimationFrame(frame);

  // ───────────── میکروفون همیشه‌روشن + حلقه واقعی صدا ─────────────
  const mic = $('micBtn');

  // متغیرهای پایپ‌لاین
  let micStreamLive = null, micCtxLive = null, micProcessor = null, micSourceLive = null;
  let micAnalyser = null, micLevelData = null, micLevelAnimId = null;
  let listeningPaused = false;   // true = در حال پردازش/TTS → چانک ارسال نشود
  let pendingConfirmUI = false;

  const floatToPCM16 = (float32) => {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const v = Math.max(-1, Math.min(1, float32[i]));
      out[i] = v < 0 ? v * 32768 : v * 32767;
    }
    return out;
  };

  // حلقه انیمیشن با سطح واقعی صدا از AnalyserNode
  const animateMicLevel = () => {
    if (!micAnalyser || !micLevelData) {
      $('orb').style.setProperty('--mic-level', '0');
      return;
    }
    micAnalyser.getByteTimeDomainData(micLevelData);
    let sum = 0;
    for (let i = 0; i < micLevelData.length; i++) {
      const v = (micLevelData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / micLevelData.length);
    // در حالت pause (فکر کردن/صحبت) سطح صدا را کم نشان بده تا کاربر متوجه شود
    const level = listeningPaused ? 0 : Math.min(1, rms * 9);
    $('orb').style.setProperty('--mic-level', level.toFixed(3));
    if (mic.classList.contains('on') && settings.micRing) {
      mic.style.setProperty('--ring-scale', (1 + level * 0.30).toFixed(3));
      mic.style.setProperty('--ring-opacity', (0.16 + level * 0.74).toFixed(3));
      mic.style.setProperty('--ring-secondary', (0.08 + level * 0.42).toFixed(3));
      mic.style.setProperty('--ring-secondary-scale', (1 + level * 0.09).toFixed(3));
    } else {
      mic.style.setProperty('--ring-scale', '1');
      mic.style.setProperty('--ring-opacity', '0');
      mic.style.setProperty('--ring-secondary', '0');
      mic.style.setProperty('--ring-secondary-scale', '1');
    }
    micLevelAnimId = requestAnimationFrame(animateMicLevel);
  };

  // شروع ضبط پیوسته — وقتی میکروفون روشن است همیشه در حال گوش دادن است
  const startContinuousCapture = async () => {
    if (micStreamLive) return; // در حال اجرا است
    try {
      const audio = settings.inputDevice !== 'default' ? { deviceId: { exact: settings.inputDevice } } : true;
      micStreamLive = await navigator.mediaDevices.getUserMedia({ audio });
      micCtxLive = new AudioContext({ sampleRate: 16000 });
      if (micCtxLive.state === 'suspended') {
        await micCtxLive.resume().catch(() => {});
      }
      micSourceLive = micCtxLive.createMediaStreamSource(micStreamLive);
      // Analyser برای سطح واقعی صدا
      micAnalyser = micCtxLive.createAnalyser();
      micAnalyser.fftSize = 256;
      micLevelData = new Uint8Array(micAnalyser.fftSize);
      micSourceLive.connect(micAnalyser);
      // ScriptProcessor برای تبدیل به PCM16 و ارسال به backend
      micProcessor = micCtxLive.createScriptProcessor(4096, 1, 1);
      micSourceLive.connect(micProcessor);
      micProcessor.connect(micCtxLive.destination);
      listeningPaused = false;
      window.assistant?.startListening();
      micProcessor.onaudioprocess = (e) => {
        if (listeningPaused || !settings.micEnabled) return;
        const pcm = floatToPCM16(e.inputBuffer.getChannelData(0));
        window.assistant?.sendAudioChunk(pcm.buffer.slice(0));
      };
      animateMicLevel();
    } catch (err) {
      say(err?.name === 'NotAllowedError' ? 'دسترسی میکروفون رد شد' : 'اتصال به میکروفون انجام نشد');
      stopCapture();
    }
  };

  const stopCapture = () => {
    cancelAnimationFrame(micLevelAnimId); micLevelAnimId = null;
    micProcessor?.disconnect(); micSourceLive?.disconnect();
    micStreamLive?.getTracks().forEach((t) => t.stop());
    micProcessor = micSourceLive = micStreamLive = null;
    micAnalyser = null; micLevelData = null;
    micCtxLive?.close?.(); micCtxLive = null;
    $('orb').style.setProperty('--mic-level', '0');
    mic.style.setProperty('--ring-scale', '1');
    mic.style.setProperty('--ring-opacity', '0');
    mic.style.setProperty('--ring-secondary', '0');
    mic.style.setProperty('--ring-secondary-scale', '1');
  };

  // ریست session و ادامه گوش دادن پس از هر دستور
  const resumeListening = () => {
    if (!settings.micEnabled) return;
    listeningPaused = false;
    window.assistant?.startListening(); // ریست VAD + chunks
  };

  const setMicEnabled = (enabled, announce = true) => {
    mic.classList.toggle('on', enabled); mic.classList.toggle('off', !enabled);
    mic.title = enabled ? 'میکروفون فعال — کلیک برای خاموش کردن' : 'میکروفون خاموش — کلیک برای روشن کردن';
    $('micEnabled').checked = enabled;
    settings.micEnabled = enabled; saveSettings();
    if (enabled) startContinuousCapture();
    else stopCapture();
    if (announce) say(enabled ? 'میکروفون روشن شد — آماده شنیدن' : 'میکروفون خاموش شد');
  };
  setMicEnabled(settings.micEnabled, false);

  // کلیک میکروفون: تایید Confirm (در صورت انتظار) یا روشن/خاموش کردن میکروفون
  mic.addEventListener('click', () => {
    if (micCtxLive && micCtxLive.state === 'suspended') {
      micCtxLive.resume().catch(() => {});
    }
    if (pendingConfirmUI) {
      pendingConfirmUI = false;
      window.assistant?.confirm(true);
      resumeListening();
      return;
    }
    setMicEnabled(!mic.classList.contains('on'));
  });
  // راست‌کلیک دکمه صدا: لغو Confirm در انتظار
  $('snd')?.addEventListener('contextmenu', (e) => {
    if (pendingConfirmUI) { e.preventDefault(); pendingConfirmUI = false; window.assistant?.confirm(false); say('لغو شد'); resumeListening(); }
  });

  let ttsAudioEl = null;
  const playTtsFile = async (filePath) => {
    try {
      const base64 = await window.assistant?.readAudioFile(filePath);
      if (!base64) return;
      ttsAudioEl?.pause();
      ttsAudioEl = new Audio(`data:audio/wav;base64,${base64}`);
      ttsAudioEl.volume = settings.outputVolume / 100;
      await ttsAudioEl.play().catch(() => {});
      // صبر می‌کنیم تا پخش صدا تمام شود تا میکروفون دوباره فعال شود (جلوگیری از echo)
      await new Promise((resolve) => {
        const el = ttsAudioEl;
        if (!el || el.ended || el.paused) { resolve(); return; }
        el.onended = resolve; el.onerror = resolve;
        setTimeout(resolve, 15000); // حداکثر ۱۵ ثانیه
      });
    } catch {}
  };

  window.assistant?.onState(({ state, payload }) => {
    if (state === 'listen') {
      applyStateByKey('listen');
      listeningPaused = false;
    } else if (state === 'thinking') {
      applyStateByKey('thinking');
      listeningPaused = true;
      if (payload?.fillerAudio) playTtsFile(payload.fillerAudio);
      if (payload?.needsConfirm) {
        pendingConfirmUI = true;
        say(payload.reply + ' — برای تایید روی میکروفون بزنید، برای لغو منتظر بمانید');
        // لغو خودکار تایید بعد از ۱۰ ثانیه بی‌تفاوتی
        setTimeout(() => { if (pendingConfirmUI) { pendingConfirmUI = false; window.assistant?.confirm(false); resumeListening(); } }, 10000);
      }
    } else if (state === 'speak') {
      applyStateByKey('speak');
      listeningPaused = true;
      if (payload?.transcript) say(`شنیدم: «${payload.transcript}»`);
    } else if (state === 'success') {
      applyStateByKey('success');
      listeningPaused = true;
      if (payload?.reply) say(payload.reply);
      if (payload?.audioPath) playTtsFile(payload.audioPath).then(() => resumeListening());
      else { if (payload?.ttsError) say(`${payload.reply || ''} (${payload.ttsHint || 'صدا پخش نشد'})`); setTimeout(resumeListening, 600); }
    } else if (state === 'error') {
      applyStateByKey('error');
      listeningPaused = true;
      say(payload?.message || payload?.reply || 'خطایی رخ داد');
      if (payload?.audioPath) playTtsFile(payload.audioPath).then(() => resumeListening());
      else { if (payload?.ttsError) say(`${payload.message || payload.reply || ''} (${payload.ttsHint || 'صدا پخش نشد'})`); setTimeout(resumeListening, 800); }
    } else if (state === 'idle') {
      applyStateByKey('idle');
      pendingConfirmUI = false;
      resumeListening();
    }
  });

  let muted = !settings.soundEnabled;
  const setMuted = (value, announce = true) => {
    muted = value; settings.soundEnabled = !value; saveSettings();
    $('snd').classList.toggle('off', value); $('soundEnabled').checked = !value;
    if (announce) say(value ? 'صدای برنامه قطع شد' : 'صدای برنامه وصل شد');
  };
  $('snd').onclick = () => setMuted(!muted);

  // Dialogs
  const showDialog = (id) => { const el = $(id); if (el && !el.open) el.showModal(); };
  $('vz').onclick = $('vz').oncontextmenu = (e) => { e.preventDefault(); showDialog('dv'); };
  $('hlp').onclick = () => showDialog('dh');
  $('set').onclick = () => showDialog('settings');
  all('[data-x]').forEach((b) => b.addEventListener('click', () => {
    closeDeviceMenus();
    const d = b.closest('dialog');
    if (d) {
      d.close();
      document.activeElement?.blur?.();
    }
  }));
  all('dialog').forEach((d) => d.addEventListener('click', (e) => {
    if (e.target === d) {
      closeDeviceMenus();
      d.close();
      document.activeElement?.blur?.();
    }
  }));
  all('dialog').forEach((d) => d.addEventListener('close', () => {
    closeDeviceMenus();
    document.activeElement?.blur?.();
  }));

  // Output test (with optional selected sink)
  let testCtx = null;
  const playTone = async (frequency = 660, seconds = .55) => {
    if (!settings.soundEnabled) { say('صدای برنامه خاموش است'); return; }
    let ctx;
    try {
      const opts = settings.outputDevice !== 'default' ? {sinkId: settings.outputDevice} : undefined;
      ctx = new AudioContext(opts);
      if (settings.outputDevice !== 'default' && typeof ctx.setSinkId === 'function') await ctx.setSinkId(settings.outputDevice);
    } catch {
      try { ctx = new AudioContext(); } catch { say('امکان پخش تست صدا وجود ندارد'); return; }
    }
    testCtx?.close?.(); testCtx = ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = frequency;
    g.gain.setValueAtTime((settings.outputVolume / 100) * .12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + seconds);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + seconds);
    o.onended = () => { ctx.close().catch(() => {}); if (testCtx === ctx) testCtx = null; };
  };

  const rng = $('rng'), vn = $('vn');
  const syncLegacyVolume = () => {
    rng.value = settings.outputVolume; rng.style.setProperty('--v', settings.outputVolume + '%'); vn.textContent = fa(settings.outputVolume);
    $('outVol').value = settings.outputVolume; $('outVol').style.setProperty('--v', settings.outputVolume + '%'); $('outVolText').textContent = fa(settings.outputVolume) + '٪';
  };
  rng.oninput = () => { settings.outputVolume = +rng.value; saveSettings(); syncLegacyVolume(); };
  $('tst').onclick = () => { playTone(); say(`صدای تست با ولوم ${fa(settings.outputVolume)}٪`); };
  $('outVol').oninput = () => { settings.outputVolume = +$('outVol').value; saveSettings(); syncLegacyVolume(); };
  $('outTest').onclick = () => { playTone(); say(`صدای تست با ولوم ${fa(settings.outputVolume)}٪`); };
  $('soundEnabled').onchange = (e) => setMuted(!e.target.checked);

  // Help update & external links in user's default browser
  $('upd').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.classList.add('busy');
    $('ut').textContent = 'در حال بررسی...';
    try {
      await window.updaterApi?.checkNow?.();
    } catch {
      b.disabled = false;
      b.classList.remove('busy');
      $('ut').textContent = 'خطا در ارتباط با سرور';
    }
  };

  window.updaterApi?.onStatus?.((data) => {
    const b = $('upd');
    if (!b) return;
    if (data.state === 'checking') {
      b.disabled = true;
      b.classList.add('busy');
      $('ut').textContent = 'در حال بررسی نسخه جدید...';
    } else if (data.state === 'available') {
      b.disabled = true;
      b.classList.remove('busy');
      $('ut').textContent = `نسخهٔ ${data.latestVersion} یافت شد!`;
      say(`نسخهٔ جدید ${data.latestVersion} آماده است، در حال دانلود...`);
    } else if (data.state === 'downloading') {
      b.disabled = true;
      b.classList.remove('busy');
      const pct = data.percent !== undefined ? `${data.percent}٪` : '';
      $('ut').textContent = `در حال دریافت بروزرسانی ${pct}`;
    } else if (data.state === 'ready') {
      b.disabled = true;
      b.classList.remove('busy');
      $('ut').textContent = 'دانلود تکمیل شد، در حال نصب...';
      say('بروزرسانی دانلود شد. در حال راه‌اندازی نسخه جدید...');
    } else if (data.state === 'none') {
      b.disabled = false;
      b.classList.remove('busy');
      $('ut').textContent = 'شما از آخرین نسخه استفاده می‌کنید';
    } else if (data.state === 'error') {
      b.disabled = false;
      b.classList.remove('busy');
      $('ut').textContent = data.message || 'بروزرسانی در دسترس نیست';
    }
  });
  all('a.help-link-btn, [data-l]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const url = el.getAttribute('href');
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        e.preventDefault();
        window.desktop?.openExternal?.(url);
      }
    });
  });

  // Device enumeration + custom in-window dropdowns
  const deviceState = {
    output: [], input: [],
    open: null
  };
  const deviceConfig = {
    output: { trigger: 'outDeviceTrigger', label: 'outDeviceLabel', menu: 'outDeviceMenu', setting: 'outputDevice', fallback: 'خروجی پیشفرض سیستم', icon: 'speaker' },
    input: { trigger: 'inDeviceTrigger', label: 'inDeviceLabel', menu: 'inDeviceMenu', setting: 'inputDevice', fallback: 'میکروفون پیشفرض سیستم', icon: 'mic' }
  };
  const closeDeviceMenus = () => {
    document.querySelectorAll('.device-select.open').forEach(el => {
      el.classList.remove('open');
      const trigger = el.querySelector('.device-trigger');
      trigger?.setAttribute('aria-expanded', 'false');
    });
    deviceState.open = null;
  };
  const setMenuSide = (wrap) => {
    const menu = wrap.querySelector('.device-menu');
    const trigger = wrap.querySelector('.device-trigger');
    if (!menu || !trigger) return;
    menu.removeAttribute('data-side');
    const r = trigger.getBoundingClientRect();
    const availableBelow = innerHeight - r.bottom - 16;
    const availableAbove = r.top - 16;
    if (availableBelow < Math.min(210, availableAbove) && availableAbove > availableBelow) menu.dataset.side = 'top';
  };
  const renderDeviceMenu = (kind) => {
    const cfg = deviceConfig[kind], menu = $(cfg.menu), current = settings[cfg.setting];
    const items = [{id:'default', label:cfg.fallback, detail:'دستگاه پیشفرض سیستم', icon:cfg.icon}, ...deviceState[kind]];
    menu.innerHTML = '';
    if (items.length === 0) { menu.innerHTML = '<div class="device-empty">دستگاهی پیدا نشد</div>'; return; }
    items.forEach(item => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'device-option' + (item.id === current ? ' selected' : '');
      b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(item.id === current));
      b.innerHTML = `<span class="device-option-icon"><svg><use href="#${cfg.icon}"/></svg></span><span class="device-option-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail || (kind === 'output' ? 'خروجی صدا' : 'ورودی صدا'))}</small></span><span class="device-option-check"><svg><use href="#check"/></svg></span>`;
      b.onclick = () => selectDevice(kind, item.id, item.label);
      menu.appendChild(b);
    });
  };
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const selectDevice = (kind, id, label) => {
    const cfg = deviceConfig[kind];
    settings[cfg.setting] = id; saveSettings();
    $(cfg.label).textContent = label;
    renderDeviceMenu(kind); closeDeviceMenus();
    say(kind === 'output' ? 'اسپیکر خروجی انتخاب شد' : 'میکروفون ورودی انتخاب شد');
  };
  const openDeviceMenu = (kind) => {
    const cfg = deviceConfig[kind], wrap = $(`${cfg.trigger}`).closest('.device-select');
    if (deviceState.open === kind) { closeDeviceMenus(); return; }
    closeDeviceMenus(); wrap.classList.add('open'); cfg && $(cfg.trigger).setAttribute('aria-expanded', 'true');
    setMenuSide(wrap); deviceState.open = kind;
  };
  ['output','input'].forEach(kind => {
    const cfg = deviceConfig[kind];
    $(cfg.trigger).onclick = () => openDeviceMenu(kind);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.device-select')) closeDeviceMenus();
  });
  window.addEventListener('resize', () => { if (deviceState.open) setMenuSide($(`[data-device-select="${deviceState.open}"]`)); });
  const fillDevices = async () => {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.() || [];
      const output = devices.filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default');
      const input = devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
      deviceState.output = output.map((d,i) => ({id:d.deviceId, label:d.label || `اسپیکر ${i + 1}`, detail:'دستگاه خروجی'}));
      deviceState.input = input.map((d,i) => ({id:d.deviceId, label:d.label || `میکروفون ${i + 1}`, detail:'دستگاه ورودی'}));
      for (const kind of ['output','input']) {
        const cfg = deviceConfig[kind];
        const valid = ['default', ...deviceState[kind].map(x => x.id)];
        if (!valid.includes(settings[cfg.setting])) settings[cfg.setting] = 'default';
        const selected = [{id:'default', label:cfg.fallback}, ...deviceState[kind]].find(x => x.id === settings[cfg.setting]);
        $(cfg.label).textContent = selected?.label || cfg.fallback;
        renderDeviceMenu(kind);
      }
      saveSettings();
    } catch {
      renderDeviceMenu('output'); renderDeviceMenu('input');
    }
  };
  navigator.mediaDevices?.addEventListener?.('devicechange', fillDevices);

  // Mic test with real local microphone permission, no backend and no playback feedback
  let testStream = null, testAudioCtx = null, testAnalyser = null, testData = null, micTesting = false;
  const stopMicTest = () => {
    micTesting = false; testStream?.getTracks().forEach(t => t.stop()); testStream = null;
    testAnalyser = null; testData = null; testAudioCtx?.close?.(); testAudioCtx = null;
    $('micMeter').style.width = '0%'; $('micTestStatus').textContent = 'آمادهٔ تست'; $('micTest').querySelector('span').textContent = 'تست میکروفون';
  };
  const micMeterFrame = () => {
    if (!micTesting || !testAnalyser) return;
    testAnalyser.getByteTimeDomainData(testData);
    let sum = 0; for (let i = 0; i < testData.length; i++) { const v = (testData[i] - 128) / 128; sum += v * v; }
    const rms = Math.min(1, Math.sqrt(sum / testData.length) * 3.2 * (settings.inputVolume / 100));
    $('micMeter').style.width = `${Math.max(2, rms * 100)}%`;
    requestAnimationFrame(micMeterFrame);
  };
  $('micTest').onclick = async () => {
    if (micTesting) { stopMicTest(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { say('تست میکروفون در این محیط در دسترس نیست'); return; }
    try {
      const audio = settings.inputDevice !== 'default' ? {deviceId: {exact: settings.inputDevice}} : true;
      testStream = await navigator.mediaDevices.getUserMedia({audio});
      testAudioCtx = new AudioContext(); const source = testAudioCtx.createMediaStreamSource(testStream);
      testAnalyser = testAudioCtx.createAnalyser(); testAnalyser.fftSize = 256; testData = new Uint8Array(testAnalyser.fftSize); source.connect(testAnalyser);
      micTesting = true; $('micTestStatus').textContent = 'در حال دریافت صدا'; $('micTest').querySelector('span').textContent = 'توقف تست';
      await fillDevices(); requestAnimationFrame(micMeterFrame); say('تست میکروفون شروع شد');
    } catch (err) {
      stopMicTest(); say(err?.name === 'NotAllowedError' ? 'دسترسی میکروفون رد شد' : 'اتصال به میکروفون انجام نشد');
    }
  };
  $('inVol').oninput = () => { settings.inputVolume = +$('inVol').value; saveSettings(); $('inVolText').textContent = fa(settings.inputVolume) + '٪'; };
  $('micEnabled').onchange = (e) => setMicEnabled(e.target.checked);

  // Theme controls
  all('#themeMode .choice').forEach((b) => b.onclick = () => { settings.themeMode = b.dataset.mode; saveSettings(); applyTheme(); refreshSettingsUI(); say('تم برنامه تغییر کرد'); });
  const wireAccentGroup = (id, modeKey) => all(`#${id} .accent`).forEach((b) => b.onclick = () => { settings.accents[modeKey] = b.dataset.accent; saveSettings(); applyTheme(); refreshSettingsUI(); say('رنگ تم ذخیره شد'); });
  wireAccentGroup('darkAccents', 'dark'); wireAccentGroup('lightAccents', 'light');

  // Existing visual settings
  $('cursorReactive').onchange = (e) => { settings.cursorReactive = e.target.checked; saveSettings(); applyTheme(); };
  $('ambientBackground').onchange = (e) => { settings.ambientBackground = e.target.checked; saveSettings(); applyTheme(); };
  $('micRing').onchange = (e) => { settings.micRing = e.target.checked; saveSettings(); };
  $('responseVisualizer').onchange = (e) => { settings.responseVisualizer = e.target.checked; saveSettings(); $('viz').classList.toggle('disabled', !settings.responseVisualizer); };

  // Startup / close native Electron settings
  let quitWithoutPrompt = settings.quitWithoutPrompt;
  const syncQuitSetting = (value) => { quitWithoutPrompt = value; settings.quitWithoutPrompt = value; saveSettings(); window.desktop?.setQuitWithoutPrompt(value); };
  $('quitWithoutPrompt').onchange = (e) => { syncQuitSetting(e.target.checked); say(e.target.checked ? 'خروج بدون پرسش فعال شد' : 'پرسش هنگام خروج فعال شد'); };
  $('startWithWindows').onchange = async (e) => {
    const requested = !!e.target.checked;
    const previous = !!settings.startWithWindows;
    settings.startWithWindows = requested; saveSettings();
    const ok = await window.desktop?.setStartWithWindows?.(requested);
    if (ok === false) { settings.startWithWindows = previous; saveSettings(); e.target.checked = previous; say('این گزینه در این محیط در دسترس نیست'); return; }
    say(requested ? 'اجرای خودکار با ویندوز فعال شد' : 'اجرای خودکار با ویندوز خاموش شد');
  };
  const loadNativeSettings = async () => {
    try {
      const native = await window.desktop?.getSettings?.();
      if (native && typeof native.openAtLogin === 'boolean') { $('startWithWindows').checked = native.openAtLogin; settings.startWithWindows = native.openAtLogin; saveSettings(); }
      else $('startWithWindows').checked = !!settings.startWithWindows;
      if (typeof native?.quitWithoutPrompt === 'boolean') { quitWithoutPrompt = native.quitWithoutPrompt; settings.quitWithoutPrompt = native.quitWithoutPrompt; }
    } catch {}
    $('quitWithoutPrompt').checked = settings.quitWithoutPrompt;
  };

  // Close / tray
  const requestQuit = () => {
    if (quitWithoutPrompt) return window.desktop?.quit();
    showDialog('de');
  };
  $('closeBtn').onclick = requestQuit;
  $('trayBtn').onclick = () => { say('در حال ارسال به Tray…'); setTimeout(() => window.desktop?.hideToTray(), 180); };
  $('toTray').onclick = () => { $('de').close(); window.desktop?.hideToTray(); };
  $('quit').onclick = () => window.desktop?.quit();
  window.desktop?.onCloseRequest(() => { if (quitWithoutPrompt) window.desktop?.quit(); else showDialog('de'); });

  // Keyboard shortcuts
  const normalizeKey = (e) => {
    let key = e.key;
    const map = {' ': 'Space', Escape: 'Esc', Enter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ',': ',', '.': '.', '/': '/', ';': ';'};
    if (map[key]) key = map[key]; else if (key.length === 1) key = key.toUpperCase();
    const parts = []; if (e.ctrlKey) parts.push('Ctrl'); if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift'); if (e.metaKey) parts.push('Win');
    parts.push(key); return parts.join(' + ');
  };
  let capturing = null;
  const shortcutButtons = all('[data-shortcut]');
  shortcutButtons.forEach(b => b.onclick = () => {
    shortcutButtons.forEach(x => x.classList.remove('recording'));
    capturing = b.dataset.shortcut; b.classList.add('recording'); b.textContent = 'کلید را بزنید…'; say(`میانبر «${b.parentElement.querySelector('strong').textContent}» را فشار دهید`);
  });
  const executeShortcut = (name) => {
    ({mic: () => setMicEnabled(!mic.classList.contains('on')), mute: () => setMuted(!muted), orbNext: () => toggleVoiceTurn(),
      volume: () => showDialog('dv'), help: () => showDialog('dh'), settings: () => showDialog('settings'),
      tray: () => window.desktop?.hideToTray(), quit: requestQuit})[name]?.();
  };
  window.addEventListener('keydown', (e) => {
    if (capturing) {
      if (['Control','Alt','Shift','Meta'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const combo = normalizeKey(e);
      const duplicate = Object.entries(settings.shortcuts).find(([name, val]) => name !== capturing && val === combo);
      if (duplicate) { say(`این میانبر قبلاً برای «${$(`[data-shortcut="${duplicate[0]}"]`).parentElement.querySelector('strong').textContent}» ثبت شده است`); return; }
      settings.shortcuts[capturing] = combo; saveSettings(); capturing = null; shortcutButtons.forEach(x => x.classList.remove('recording')); refreshSettingsUI(); say('میانبر ذخیره شد'); return;
    }
    const combo = normalizeKey(e);
    const hit = Object.entries(settings.shortcuts).find(([, value]) => value === combo);
    if (hit) { e.preventDefault(); executeShortcut(hit[0]); }
  }, true);

  const refreshSettingsUI = () => {
    all('#themeMode .choice').forEach(b => b.classList.toggle('selected', b.dataset.mode === settings.themeMode));
    const dark = settings.accents.dark, light = settings.accents.light;
    all('#darkAccents .accent').forEach(b => b.classList.toggle('selected', b.dataset.accent === dark));
    all('#lightAccents .accent').forEach(b => b.classList.toggle('selected', b.dataset.accent === light));
    $('soundEnabled').checked = settings.soundEnabled;
    $('micEnabled').checked = settings.micEnabled;
    $('startWithWindows').checked = !!settings.startWithWindows;
    $('quitWithoutPrompt').checked = !!settings.quitWithoutPrompt;
    $('cursorReactive').checked = settings.cursorReactive; $('ambientBackground').checked = settings.ambientBackground;
    $('micRing').checked = settings.micRing; $('responseVisualizer').checked = settings.responseVisualizer;
    $('responseVisualizer').dispatchEvent(new Event('change'));
    $('outVol').value = settings.outputVolume; $('inVol').value = settings.inputVolume;
    $('outVol').style.setProperty('--v', settings.outputVolume + '%'); $('outVolText').textContent = fa(settings.outputVolume) + '٪';
    $('inVol').style.setProperty('--v', settings.inputVolume + '%'); $('inVolText').textContent = fa(settings.inputVolume) + '٪';
    shortcutButtons.forEach(b => { if (capturing !== b.dataset.shortcut) b.textContent = settings.shortcuts[b.dataset.shortcut]; });
  };

  $('resetSettings').onclick = () => {
    Object.assign(settings, structuredClone(DEFAULTS)); saveSettings();
    setMicEnabled(true, false); setMuted(false, false); applyTheme(); refreshSettingsUI(); fillDevices(); say('تنظیمات بازگردانی شد');
    window.desktop?.setQuitWithoutPrompt(false); window.desktop?.setStartWithWindows(false);
  };

  // ───────────── تنظیمات بخش دستیار صوتی (آستانهٔ سکوت، حساسیت VAD، صدای TTS) ─────────────
  if ($('silenceMs')) {
    $('silenceMs').value = settings.silenceMs;
    $('silenceMsText').textContent = (settings.silenceMs / 1000).toFixed(1) + ' ثانیه';
    $('silenceMs').oninput = (e) => {
      settings.silenceMs = +e.target.value; saveSettings();
      $('silenceMsText').textContent = (settings.silenceMs / 1000).toFixed(1) + ' ثانیه';
    };
  }
  if ($('vadThreshold')) {
    $('vadThreshold').value = Math.round(settings.vadThreshold * 1000);
    $('vadThreshold').oninput = (e) => { settings.vadThreshold = (+e.target.value) / 1000; saveSettings(); };
  }
  if ($('ttsVoice')) {
    $('ttsVoice').value = settings.ttsVoice || 'amir-medium';
    $('ttsVoice').onchange = (e) => { settings.ttsVoice = e.target.value; saveSettings(); };
  }

  syncLegacyVolume();
  $('inVol').style.setProperty('--v', settings.inputVolume + '%');
  refreshSettingsUI(); applyTheme();
  fillDevices(); loadNativeSettings();
  hydrateFromSecureStore();

  // اگر Piper کامل نصب/کانفیگ نشده باشد، همان ابتدای اجرای برنامه به‌جای سکوت بی‌دلیل یک پیام واضح نشان بده
  window.ttsDebug?.onWarning((diag) => {
    const missing = [];
    if (!diag.binaryExists) missing.push('piper.exe');
    if (!diag.modelExists) missing.push('مدل .onnx');
    if (!diag.configExists) missing.push('فایل .onnx.json');
    say(`صدای پاسخ فعال نیست — ${missing.join('، ')} پیدا نشد (راهنما: assets/piper/README.md)`);
  });

  $('vz').setAttribute('aria-pressed', 'false');
})();
