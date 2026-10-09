# نصب Piper TTS (آفلاین)

چون این محیط به اینترنت دسترسی ندارد، باینری و مدل Piper باید دستی دانلود و در این مسیرها قرار بگیرند:

```
assets/piper/win/piper.exe          ← باینری Piper برای ویندوز (از ریلیزهای رسمی Piper)
assets/piper/model/amir-medium.onnx
assets/piper/model/amir-medium.onnx.json
```

منبع دانلود:
- باینری: ریلیزهای GitHub پروژهٔ `rhasspy/piper` (نسخهٔ `windows` را بردارید)
- مدل صدای فارسی `amir-medium`: مخزن `rhasspy/piper-voices` (مسیر `fa/fa_IR/amir/medium`)

بعد از قرار دادن فایل‌ها، `backend/tts.isReady()` به‌صورت خودکار تشخیص می‌دهد که Piper آماده است یا نه،
و تا قبل از آن، تابع `synthesize` خطای `PIPER_NOT_INSTALLED` برمی‌گرداند (بدون کرش برنامه).

هنگام ساخت نسخهٔ نهایی (`electron-builder`)، این پوشه طبق تنظیمات `extraResources` در package.json
در کنار فایل اجرایی نصب‌شده کپی می‌شود، نه داخل asar.
