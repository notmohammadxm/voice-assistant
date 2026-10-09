// backend/tts.js
// تبدیل متن به گفتار با Piper (کاملاً آفلاین، اجرای باینری local).
// باینری piper و فایل مدل باید از قبل در assets/piper/ قرار گرفته باشند (بسته به پلتفرم):
//   assets/piper/win/piper.exe   (در ویندوز)
//   assets/piper/model/amir-medium.onnx
//   assets/piper/model/amir-medium.onnx.json

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

function resourceRoot() {
  // در حالت بسته‌بندی‌شده (production) باید داخل resources باشد، در dev داخل خود پروژه
  return app.isPackaged
    ? path.join(process.resourcesPath, 'piper')
    : path.join(__dirname, '..', 'assets', 'piper');
}

function binaryPath() {
  const root = resourceRoot();
  if (process.platform === 'win32') return path.join(root, 'win', 'piper.exe');
  if (process.platform === 'darwin') return path.join(root, 'mac', 'piper');
  return path.join(root, 'linux', 'piper');
}

function modelPaths(voice = 'amir-medium') {
  const root = resourceRoot();
  return {
    onnx: path.join(root, 'model', `${voice}.onnx`),
    config: path.join(root, 'model', `${voice}.onnx.json`)
  };
}

function isReady(voice = 'amir-medium') {
  const bin = binaryPath();
  const { onnx, config } = modelPaths(voice);
  return fs.existsSync(bin) && fs.existsSync(onnx) && fs.existsSync(config);
}

/** گزارش دقیق اینکه کدام فایل لازم موجود نیست (برای دیباگ، نه فقط true/false) */
function diagnose(voice = 'amir-medium') {
  const bin = binaryPath();
  const { onnx, config } = modelPaths(voice);
  return {
    binaryPath: bin, binaryExists: fs.existsSync(bin),
    modelPath: onnx, modelExists: fs.existsSync(onnx),
    configPath: config, configExists: fs.existsSync(config),
    platform: process.platform
  };
}

/**
 * متن را به فایل WAV تبدیل می‌کند.
 * @param {string} text متن فارسی
 * @param {object} opts
 * @param {string} [opts.voice='amir-medium']
 * @returns {Promise<string>} مسیر فایل WAV موقت تولیدشده
 */
function synthesize(text, { voice = 'amir-medium' } = {}) {
  return new Promise((resolve, reject) => {
    if (!text || !text.trim()) { reject(new Error('EMPTY_TEXT')); return; }
    if (!isReady(voice)) { reject(new Error('PIPER_NOT_INSTALLED')); return; }

    const bin = binaryPath();
    const { onnx } = modelPaths(voice);
    const outFile = path.join(os.tmpdir(), `va-tts-${Date.now()}.wav`);

    const proc = spawn(bin, ['--model', onnx, '--output_file', outFile], {
      windowsHide: true
    });

    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outFile)) resolve(outFile);
      else reject(new Error(stderr || `PIPER_EXIT_${code}`));
    });

    proc.stdin.write(text.trim() + '\n');
    proc.stdin.end();
  });
}

module.exports = { synthesize, isReady, diagnose, binaryPath, modelPaths };
