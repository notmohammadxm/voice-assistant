// backend/commands/matcher.js
// موتور تطبیق دستور بدون LLM. الگوها از commands.json (قابل‌ویرایش توسط کاربر/بعداً پنل مدیریت) خوانده می‌شوند.
// پشتیبانی از placeholder مثل {query} و {site} در الگوها برای استخراج پارامتر آزاد از جملهٔ کاربر.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_FILE = path.join(__dirname, 'commands.default.json');
const USER_FILE = () => path.join(app.getPath('userData'), 'commands.json');

function loadCommands() {
  try {
    const userPath = USER_FILE();
    if (fs.existsSync(userPath)) return JSON.parse(fs.readFileSync(userPath, 'utf8'));
  } catch {}
  return JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
}

function saveCommands(list) {
  fs.writeFileSync(USER_FILE(), JSON.stringify(list, null, 2), 'utf8');
}

function normalize(text) {
  return String(text || '')
    .trim()
    .replace(/[\u200c\u200f\u200e]/g, '')
    .replace(/[.,،!؟?]/g, '')
    .toLowerCase();
}

/** یک الگوی دارای {param} را به RegExp تبدیل می‌کند */
function patternToRegex(pattern) {
  const paramNames = [];
  const escaped = pattern
    .split(/(\{[a-zA-Z_]+\})/g)
    .map((part) => {
      const m = part.match(/^\{([a-zA-Z_]+)\}$/);
      if (m) { paramNames.push(m[1]); return '(.+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return { regex: new RegExp('^' + escaped + '$', 'i'), paramNames };
}

/**
 * جمله‌ی کاربر را با دستورات تطبیق می‌دهد.
 * @param {string} utterance متن خام رسیده از STT
 * @returns {{command: object, params: object}|null}
 */
function match(utterance) {
  const text = normalize(utterance);
  if (!text) return null;
  const commands = loadCommands();

  for (const cmd of commands) {
    for (const pattern of cmd.patterns || []) {
      const { regex, paramNames } = patternToRegex(normalize(pattern));
      const m = text.match(regex);
      if (m) {
        const params = { ...(cmd.params || {}) };
        paramNames.forEach((name, i) => { params[name] = (m[i + 1] || '').trim(); });
        return { command: cmd, params };
      }
    }
  }
  return null;
}

/** جایگزینی {placeholder} در متن پاسخ */
function fillTemplate(template, params) {
  return String(template || '').replace(/\{([a-zA-Z_]+)\}/g, (_, k) => (params[k] ?? ''));
}

module.exports = { loadCommands, saveCommands, match, fillTemplate, normalize };
