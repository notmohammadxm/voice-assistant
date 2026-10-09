// backend/commands/executor.js
// اجرای واقعی اکشن‌های سیستمی. بدون whitelist محدودکننده (طبق تصمیم پروژه)،
// اما ورودی‌های آزاد (مثل عبارت جستجو/نام سایت) قبل از ورود به exec/URL، sanitize سبک می‌شوند
// تا از کرش برنامه یا شکستن دستور شل جلوگیری شود؛ این محدودیتِ قابلیت نیست، فقط ایمنیِ اجراست.

const { shell, clipboard } = require('electron');
const { exec } = require('child_process');
const https = require('https');
const path = require('path');

function sanitizeForShell(str) {
  // کاراکترهای خطرناک برای ساخت دستور شل ویندوز را حذف می‌کند (& | ^ < > و کوتیشن‌ها)
  return String(str || '').replace(/["'`&|<>^]/g, '').trim();
}

function toDigitsFa2En(str) {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  return String(str || '').replace(/[۰-۹]/g, (d) => fa.indexOf(d));
}

/** استخراج مدت‌زمان از متن آزاد فارسی/انگلیسی (مثل «۵ دقیقه»، «10 minutes»، «نیم ساعت») به میلی‌ثانیه */
function parseDuration(text) {
  const t = toDigitsFa2En(String(text || '')).toLowerCase();
  const numMatch = t.match(/\d+(\.\d+)?/);
  let num = numMatch ? parseFloat(numMatch[0]) : null;
  if (num === null) {
    if (/نیم/.test(t)) num = 0.5;
    else num = 1; // اگر عددی نبود، پیش‌فرض ۱ واحد
  }
  let unitMs = 60 * 1000; // پیش‌فرض: دقیقه
  if (/ثانیه|second|sec\b/.test(t)) unitMs = 1000;
  else if (/ساعت|hour/.test(t)) unitMs = 60 * 60 * 1000;
  else if (/دقیقه|minute|min\b/.test(t)) unitMs = 60 * 1000;
  return Math.max(1000, Math.round(num * unitMs));
}

/** بررسی اتصال اینترنت با یک درخواست HEAD سبک */
function checkInternet(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'www.google.com', path: '/', method: 'HEAD', timeout: timeoutMs }, (res) => {
      resolve(res.statusCode < 500); res.destroy();
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

const APP_COMMANDS = {
  win32: {
    browser: 'start msedge',
    notepad: 'start notepad',
    calculator: 'start calc',
    explorer: 'start explorer',
    cmd: 'start cmd',
    powershell: 'start powershell',
    taskmanager: 'start taskmgr',
    controlpanel: 'start control',
    settings: 'start ms-settings:',
    paint: 'start mspaint',
    word: 'start winword',
    excel: 'start excel',
    powerpoint: 'start powerpnt',
    recyclebin: 'start shell:RecycleBinFolder'
  },
  darwin: {
    browser: 'open -a Safari',
    notepad: 'open -a TextEdit',
    calculator: 'open -a Calculator',
    explorer: 'open .'
  },
  linux: {
    browser: 'xdg-open https://google.com',
    notepad: 'xdg-open .',
    calculator: 'gnome-calculator',
    explorer: 'xdg-open .'
  }
};

function runShell(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(err); else resolve({ stdout, stderr });
    });
  });
}

const handlers = {
  'system.say_time': async () => {
    const now = new Date();
    return { ok: true, vars: { time: now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) } };
  },
  'system.say_date': async () => {
    const now = new Date();
    return { ok: true, vars: { date: now.toLocaleDateString('fa-IR-u-ca-persian') } };
  },
  'app.open': async ({ params }) => {
    const table = APP_COMMANDS[process.platform] || APP_COMMANDS.win32;
    const target = params.target && table[params.target] ? table[params.target] : null;
    if (target) await runShell(target);
    else if (params.target) await runShell(sanitizeForShell(params.target)); // باز کردن هر برنامهٔ دیگر با نام دلخواه
    return { ok: true, vars: {} };
  },
  'app.close_active': async () => {
    if (process.platform === 'win32') {
      await runShell('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys(\'%{F4}\')"');
    } else if (process.platform === 'linux') {
      await runShell('xdotool getactivewindow windowclose 2>/dev/null || true').catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'web.search': async ({ params }) => {
    const q = encodeURIComponent(sanitizeForShell(params.query || ''));
    await shell.openExternal(`https://www.google.com/search?q=${q}`);
    return { ok: true, vars: { query: params.query || '' } };
  },
  'web.open_site': async ({ params }) => {
    let site = sanitizeForShell(params.site || '').replace(/\s+/g, '');
    if (!/^https?:\/\//i.test(site)) {
      site = /\./.test(site) ? `https://${site}` : `https://www.google.com/search?q=${encodeURIComponent(site)}`;
    }
    await shell.openExternal(site);
    return { ok: true, vars: { site: params.site || '' } };
  },
  'system.volume_up': async () => {
    if (process.platform === 'win32') {
      await runShell('powershell -command "0..4 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"');
    } else if (process.platform === 'linux') {
      await runShell('pactl set-sink-volume @DEFAULT_SINK@ +10% 2>/dev/null || amixer -D pulse sset Master 10%+ 2>/dev/null || true').catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'system.volume_down': async () => {
    if (process.platform === 'win32') {
      await runShell('powershell -command "0..4 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }"');
    } else if (process.platform === 'linux') {
      await runShell('pactl set-sink-volume @DEFAULT_SINK@ -10% 2>/dev/null || amixer -D pulse sset Master 10%- 2>/dev/null || true').catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'system.volume_mute': async () => {
    if (process.platform === 'win32') {
      await runShell('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"');
    } else if (process.platform === 'linux') {
      await runShell('pactl set-sink-mute @DEFAULT_SINK@ toggle 2>/dev/null || amixer -D pulse sset Master toggle 2>/dev/null || true').catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'system.shutdown': async () => {
    if (process.platform === 'win32') await runShell('shutdown /s /t 5');
    else await runShell('shutdown -h +1 2>/dev/null || systemctl poweroff 2>/dev/null || true');
    return { ok: true, vars: {} };
  },
  'system.restart': async () => {
    if (process.platform === 'win32') await runShell('shutdown /r /t 5');
    else await runShell('shutdown -r +1 2>/dev/null || systemctl reboot 2>/dev/null || true');
    return { ok: true, vars: {} };
  },
  'system.lock': async () => {
    if (process.platform === 'win32') await runShell('rundll32.exe user32.dll,LockWorkStation');
    else if (process.platform === 'linux') {
      await runShell('loginctl lock-session 2>/dev/null || xdg-screensaver lock 2>/dev/null || gnome-screensaver-command -l 2>/dev/null || true').catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'system.sleep': async () => {
    if (process.platform === 'win32') await runShell('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    else if (process.platform === 'linux') await runShell('systemctl suspend 2>/dev/null || true').catch(() => {});
    return { ok: true, vars: {} };
  },
  'system.help': async () => ({ ok: true, vars: {} }),
  'none': async () => ({ ok: true, vars: {} }),

  'open.folder': async ({ params }) => {
    const { app: electronApp } = require('electron');
    const map = {
      downloads: electronApp.getPath('downloads'),
      documents: electronApp.getPath('documents'),
      desktop: electronApp.getPath('desktop'),
      pictures: electronApp.getPath('pictures'),
      music: electronApp.getPath('music'),
      videos: electronApp.getPath('videos')
    };
    const target = map[params.target];
    if (target) await shell.openPath(target);
    return { ok: true, vars: {} };
  },
  'media.play_pause': async () => {
    if (process.platform === 'win32') await runShell('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"');
    else if (process.platform === 'linux') await runShell('playerctl play-pause 2>/dev/null || true').catch(() => {});
    return { ok: true, vars: {} };
  },
  'media.next': async () => {
    if (process.platform === 'win32') await runShell('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]176)"');
    else if (process.platform === 'linux') await runShell('playerctl next 2>/dev/null || true').catch(() => {});
    return { ok: true, vars: {} };
  },
  'media.prev': async () => {
    if (process.platform === 'win32') await runShell('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]177)"');
    else if (process.platform === 'linux') await runShell('playerctl previous 2>/dev/null || true').catch(() => {});
    return { ok: true, vars: {} };
  },
  'system.minimize_all': async () => {
    if (process.platform === 'win32') {
      await runShell('powershell -command "(New-Object -ComObject Shell.Application).MinimizeAll()"');
    } else if (process.platform === 'linux') {
      await runShell('wmctrl -k on 2>/dev/null || true').catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'system.show_desktop': async () => {
    if (process.platform === 'win32') {
      await runShell('powershell -command "(New-Object -ComObject Shell.Application).ToggleDesktop()"');
    } else if (process.platform === 'linux') {
      await runShell('wmctrl -k on 2>/dev/null || true').catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'system.screenshot': async () => {
    const { app: electronApp } = require('electron');
    if (process.platform === 'win32') {
      const outPath = path.join(electronApp.getPath('pictures'), `screenshot-${Date.now()}.png`);
      const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
        `$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
        `$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; ` +
        `$g=[System.Drawing.Graphics]::FromImage($bmp); ` +
        `$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); ` +
        `$bmp.Save('${outPath.replace(/\\/g, '\\\\')}')`;
      await runShell(`powershell -command "${ps}"`);
    } else if (process.platform === 'linux') {
      const outPath = path.join(electronApp.getPath('pictures'), `screenshot-${Date.now()}.png`);
      await runShell(`gnome-screenshot -f "${outPath}" 2>/dev/null || scrot "${outPath}" 2>/dev/null || import -window root "${outPath}" 2>/dev/null || true`).catch(() => {});
    }
    return { ok: true, vars: {} };
  },
  'system.signout': async () => {
    if (process.platform === 'win32') await runShell('shutdown /l');
    return { ok: true, vars: {} };
  },

  // دیکته/تایپ با صدا: متن در کلیپ‌بورد قرار می‌گیرد و با Ctrl+V در پنجرهٔ فعال پیست می‌شود.
  // نکته: چون همین لحظه پنجرهٔ برنامهٔ دستیار فوکوس دارد، یک تاخیر کوتاه داده می‌شود تا
  // کاربر فرصت کند به پنجرهٔ مقصد (مثلاً نوت‌پد) سوییچ کند؛ بعد از پیست، کلیپ‌بورد قبلی برمی‌گردد.
  'text.type': async ({ params }) => {
    if (process.platform !== 'win32') return { ok: true, vars: {} };
    const text = params.text || '';
    if (!text.trim()) return { ok: false, vars: {} };
    const previousClipboard = clipboard.readText();
    clipboard.writeText(text);
    setTimeout(async () => {
      try {
        await runShell('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys(\'^v\')"');
      } finally {
        setTimeout(() => clipboard.writeText(previousClipboard || ''), 800);
      }
    }, 1800); // فرصت برای سوییچ به پنجرهٔ مقصد
    return { ok: true, vars: {} };
  },

  'system.set_timer': async ({ params, context }) => {
    const ms = parseDuration(params.duration);
    const label = params.duration || '';
    context?.session?.scheduleTimer(ms, label);
    return { ok: true, vars: {} };
  },

  'system.net_status': async () => {
    const online = await checkInternet();
    return { ok: true, vars: { status: online ? 'وصل است' : 'قطع است' } };
  }
};

/**
 * اجرای اکشن یک دستور تطبیق‌یافته
 * @param {{command: object, params: object}} matched خروجی matcher.match
 * @param {{session?: object}} [context] دسترسی به Session فعلی (برای تایمر و امثال آن)
 * @returns {Promise<{ok:boolean, reply:string, needsConfirm?:boolean}>}
 */
async function execute(matched, context = {}) {
  const { command, params } = matched;
  const handler = handlers[command.action];
  if (!handler) return { ok: false, reply: 'این دستور هنوز پیاده‌سازی نشده است' };

  if (command.confirm) {
    return { ok: true, reply: command.reply, needsConfirm: true, pending: matched };
  }

  try {
    const result = await handler({ params, context });
    const { fillTemplate } = require('./matcher');
    const reply = fillTemplate(command.reply, { ...params, ...(result.vars || {}) });
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, reply: 'در اجرای دستور خطایی رخ داد' };
  }
}

module.exports = { execute, handlers };
