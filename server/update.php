<?php
/**
 * Voice Assistant - Update Server & Management Dashboard
 * Single-file PHP solution: REST API + Dark Mode Modern Admin Panel
 * No login, no database required (self-contained JSON storage)
 * Supports 3 Targets: Windows (.exe), Linux Debian (.deb), Linux AppImage (.AppImage)
 */

declare(strict_types=1);

// Disable error display in production API responses
error_reporting(E_ALL);
ini_set('display_errors', '0');

$dataFile = __DIR__ . '/update_config.json';

// Default configuration if file does not exist
$defaultConfig = [
    'win' => [
        'latest_version' => '0.1.3',
        'download_url'   => '',
        'mandatory'      => false,
        'release_notes'  => 'Voice Assistant Windows release.'
    ],
    'deb' => [
        'latest_version' => '0.1.3',
        'download_url'   => '',
        'mandatory'      => false,
        'release_notes'  => 'Voice Assistant Linux Debian / Ubuntu (.deb) release.'
    ],
    'appimage' => [
        'latest_version' => '0.1.3',
        'download_url'   => '',
        'mandatory'      => false,
        'release_notes'  => 'Voice Assistant Linux AppImage standalone portable release.'
    ],
    'updated_at' => date('Y-m-d H:i:s')
];

// Helper: load config with legacy migration support
function loadConfig(string $path, array $default): array {
    if (!file_exists($path)) {
        file_put_contents($path, json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        return $default;
    }
    $raw = @file_get_contents($path);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) {
        return $default;
    }

    // Migrate legacy 'linux' key to 'deb' if needed
    if (isset($data['linux']) && !isset($data['deb'])) {
        $data['deb'] = $data['linux'];
    }
    if (!isset($data['appimage'])) {
        $data['appimage'] = [
            'latest_version' => $data['deb']['latest_version'] ?? '0.1.3',
            'download_url'   => '',
            'mandatory'      => false,
            'release_notes'  => 'Voice Assistant Linux AppImage release.'
        ];
    }

    return array_replace_recursive($default, $data);
}

// Helper: save config
function saveConfig(string $path, array $data): bool {
    $data['updated_at'] = date('Y-m-d H:i:s');
    return (bool) file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

$config = loadConfig($dataFile, $defaultConfig);

// ─────────────────────────────────────────────────────────────
// 1. REST API Endpoint for Desktop App
// ─────────────────────────────────────────────────────────────
if (isset($_GET['action']) && $_GET['action'] === 'check') {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');

    $clientVersion = trim((string)($_GET['version'] ?? '0.0.0'));
    $requestedTarget = strtolower(trim((string)($_GET['target'] ?? $_GET['format'] ?? $_GET['platform'] ?? 'win')));

    // Resolve which target config to query
    if (strpos($requestedTarget, 'appimage') !== false) {
        $targetKey = 'appimage';
        $formatExt = 'appimage';
    } elseif (strpos($requestedTarget, 'deb') !== false) {
        $targetKey = 'deb';
        $formatExt = 'deb';
    } elseif (strpos($requestedTarget, 'linux') !== false) {
        $fmt = strtolower(trim((string)($_GET['format'] ?? '')));
        if ($fmt === 'appimage') {
            $targetKey = 'appimage';
            $formatExt = 'appimage';
        } else {
            $targetKey = 'deb';
            $formatExt = 'deb';
        }
    } else {
        $targetKey = 'win';
        $formatExt = 'exe';
    }

    $targetConfig = $config[$targetKey] ?? $config['win'];
    $latestVersion = (string)($targetConfig['latest_version'] ?? '0.0.0');
    $isUpdateAvailable = version_compare($latestVersion, $clientVersion, '>');

    echo json_encode([
        'updateAvailable' => $isUpdateAvailable,
        'currentVersion'  => $clientVersion,
        'latestVersion'   => $latestVersion,
        'downloadUrl'     => $targetConfig['download_url'] ?? '',
        'mandatory'       => (bool)($targetConfig['mandatory'] ?? false),
        'releaseNotes'    => $targetConfig['release_notes'] ?? '',
        'platform'        => $targetKey,
        'format'          => $formatExt,
        'serverTime'      => date('Y-m-d H:i:s')
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

// ─────────────────────────────────────────────────────────────
// 2. Handle Admin Form Submission
// ─────────────────────────────────────────────────────────────
$message = '';
$messageType = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['save_settings'])) {
    // Windows
    $config['win']['latest_version'] = trim((string)($_POST['win_version'] ?? '0.1.3'));
    $config['win']['download_url']   = trim((string)($_POST['win_download_url'] ?? ''));
    $config['win']['release_notes']  = trim((string)($_POST['win_notes'] ?? ''));
    $config['win']['mandatory']      = isset($_POST['win_mandatory']);

    // Linux Debian (.deb)
    $config['deb']['latest_version'] = trim((string)($_POST['deb_version'] ?? '0.1.3'));
    $config['deb']['download_url']   = trim((string)($_POST['deb_download_url'] ?? ''));
    $config['deb']['release_notes']  = trim((string)($_POST['deb_notes'] ?? ''));
    $config['deb']['mandatory']      = isset($_POST['deb_mandatory']);

    // Linux AppImage (.AppImage)
    $config['appimage']['latest_version'] = trim((string)($_POST['appimage_version'] ?? '0.1.3'));
    $config['appimage']['download_url']   = trim((string)($_POST['appimage_download_url'] ?? ''));
    $config['appimage']['release_notes']  = trim((string)($_POST['appimage_notes'] ?? ''));
    $config['appimage']['mandatory']      = isset($_POST['appimage_mandatory']);

    if (saveConfig($dataFile, $config)) {
        $message = 'Settings updated successfully for all platforms.';
        $messageType = 'success';
    } else {
        $message = 'Failed to write configuration file. Please check folder permissions.';
        $messageType = 'error';
    }
}

// Full current URL for endpoint display
$currentProtocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";
$currentHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
$currentScript = $_SERVER['SCRIPT_NAME'] ?? '/update.php';
$baseUrl = $currentProtocol . $currentHost . $currentScript;

$winEndpoint = $baseUrl . '?action=check&version=0.1.3&platform=win';
$debEndpoint = $baseUrl . '?action=check&version=0.1.3&platform=deb';
$appImageEndpoint = $baseUrl . '?action=check&version=0.1.3&platform=appimage';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Assistant - Update Control Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 25, 42, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --input-bg: rgba(12, 17, 30, 0.85);
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.25);
      --accent-secondary: #818cf8;
      --win-color: #38bdf8;
      --deb-color: #f43f5e;
      --appimage-color: #10b981;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --success: #34d399;
      --success-bg: rgba(52, 211, 153, 0.12);
      --error: #f87171;
      --error-bg: rgba(248, 113, 113, 0.12);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(56, 189, 248, 0.08), transparent 35%),
        radial-gradient(circle at 85% 75%, rgba(129, 140, 248, 0.07), transparent 40%);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 24px;
      width: 100%;
      flex: 1;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 20px var(--accent-glow);
    }

    .brand-icon svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: #090d16;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .brand-text h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .brand-text p {
      font-size: 13px;
      color: var(--text-muted);
    }

    .server-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      padding: 6px 14px;
      border-radius: 99px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .alert {
      padding: 14px 18px;
      border-radius: 12px;
      margin-bottom: 24px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      animation: slideDown 0.25s ease-out;
    }

    .alert.success {
      background: var(--success-bg);
      border: 1px solid rgba(52, 211, 153, 0.3);
      color: var(--success);
    }

    .alert.error {
      background: var(--error-bg);
      border: 1px solid rgba(248, 113, 113, 0.3);
      color: var(--error);
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .api-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 32px;
      backdrop-filter: blur(16px);
    }

    .api-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .api-card-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .endpoint-tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .endpoint-tab-btn {
      padding: 6px 14px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s;
    }

    .endpoint-tab-btn:hover {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border-color: rgba(56, 189, 248, 0.4);
    }

    .endpoint-code {
      display: flex;
      align-items: center;
      background: var(--input-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 10px 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #38bdf8;
      overflow-x: auto;
      word-break: break-all;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 32px;
    }

    @media (max-width: 1024px) {
      .grid { grid-template-columns: 1fr; }
    }

    .panel-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 24px;
      backdrop-filter: blur(16px);
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      transition: border-color 0.2s ease;
    }

    .panel-card:hover {
      border-color: rgba(255, 255, 255, 0.16);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--card-border);
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 15px;
      font-weight: 600;
    }

    .panel-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 99px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
    }

    .badge-win { color: var(--win-color); border-color: rgba(56, 189, 248, 0.3); background: rgba(56, 189, 248, 0.08); }
    .badge-deb { color: var(--deb-color); border-color: rgba(244, 63, 94, 0.3); background: rgba(244, 63, 94, 0.08); }
    .badge-appimage { color: var(--appimage-color); border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.08); }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    input[type="text"],
    textarea {
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 10px 14px;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: var(--text);
      transition: all 0.2s ease;
    }

    input[type="text"]:focus,
    textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    textarea {
      resize: vertical;
      min-height: 75px;
      line-height: 1.45;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      user-select: none;
      padding: 6px 0;
      margin-top: 4px;
    }

    .checkbox-row input[type="checkbox"] {
      width: 17px;
      height: 17px;
      accent-color: var(--accent);
      cursor: pointer;
    }

    .checkbox-label {
      font-size: 13px;
      color: var(--text);
    }

    .actions-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 16px 24px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      margin-top: 8px;
    }

    .last-updated {
      font-size: 13px;
      color: var(--text-muted);
    }

    button.btn-primary {
      background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
      color: #090d16;
      font-weight: 600;
      font-size: 14px;
      border: none;
      padding: 12px 32px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 20px var(--accent-glow);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    button.btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 24px var(--accent-glow);
    }

    button.btn-primary:active {
      transform: translateY(1px);
    }

    footer {
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      padding: 28px;
      border-top: 1px solid var(--card-border);
      margin-top: 40px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
        </div>
        <div class="brand-text">
          <h1>Voice Assistant</h1>
          <p>Multi-Platform Update Distribution Server</p>
        </div>
      </div>
      <div class="server-status">
        <div class="status-dot"></div>
        <span>REST API Live</span>
      </div>
    </header>

    <?php if ($message): ?>
      <div class="alert <?= htmlspecialchars($messageType) ?>">
        <span><?= htmlspecialchars($message) ?></span>
      </div>
    <?php endif; ?>

    <div class="api-card">
      <div class="api-card-header">
        <span class="api-card-title">Live API Endpoints</span>
        <span style="font-size: 12px; color: var(--text-muted);">Click to test target JSON:</span>
      </div>
      <div class="endpoint-tabs">
        <a class="endpoint-tab-btn" href="<?= htmlspecialchars($winEndpoint) ?>" target="_blank">Windows Test API &rarr;</a>
        <a class="endpoint-tab-btn" href="<?= htmlspecialchars($debEndpoint) ?>" target="_blank">Linux Debian (.deb) Test API &rarr;</a>
        <a class="endpoint-tab-btn" href="<?= htmlspecialchars($appImageEndpoint) ?>" target="_blank">Linux AppImage Test API &rarr;</a>
      </div>
      <div class="endpoint-code">
        <?= htmlspecialchars($baseUrl) ?>?action=check&amp;version=0.1.3&amp;platform=[win | deb | appimage]
      </div>
    </div>

    <form method="POST" action="">
      <input type="hidden" name="save_settings" value="1">

      <div class="grid">
        <!-- 1. Windows Configuration -->
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <svg style="width: 18px; height: 18px; fill: var(--win-color);" viewBox="0 0 24 24">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
              </svg>
              <span>Windows</span>
            </div>
            <span class="panel-badge badge-win">NSIS .exe</span>
          </div>

          <div class="form-group">
            <label for="win_version">Latest Version</label>
            <input type="text" id="win_version" name="win_version" value="<?= htmlspecialchars((string)($config['win']['latest_version'] ?? '0.1.3')) ?>" required placeholder="0.1.4">
          </div>

          <div class="form-group">
            <label for="win_download_url">Download URL (.exe)</label>
            <input type="text" id="win_download_url" name="win_download_url" value="<?= htmlspecialchars((string)($config['win']['download_url'] ?? '')) ?>" placeholder="https://.../Voice_Assistant_Setup_0.1.4.exe">
          </div>

          <div class="form-group">
            <label for="win_notes">Changelog / Release Notes</label>
            <textarea id="win_notes" name="win_notes" placeholder="Release notes for Windows..."><?= htmlspecialchars((string)($config['win']['release_notes'] ?? '')) ?></textarea>
          </div>

          <label class="checkbox-row">
            <input type="checkbox" name="win_mandatory" <?= !empty($config['win']['mandatory']) ? 'checked' : '' ?>>
            <span class="checkbox-label">Mandatory (Force update)</span>
          </label>
        </div>

        <!-- 2. Linux Debian (.deb) Configuration -->
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <svg style="width: 18px; height: 18px; fill: var(--deb-color);" viewBox="0 0 24 24">
                <path d="M12.003 0c-2.455 0-4.446 1.991-4.446 4.446 0 1.341.597 2.544 1.543 3.355C5.836 8.647 3.328 11.758 3.328 15.556c0 .878.139 1.722.396 2.518C1.558 19.123 0 21.378 0 24h24c0-2.622-1.558-4.877-3.724-5.926.257-.796.396-1.64.396-2.518 0-3.798-2.508-6.909-5.772-7.755.946-.811 1.543-2.014 1.543-3.355C16.449 1.991 14.458 0 12.003 0z"/>
              </svg>
              <span>Linux Debian</span>
            </div>
            <span class="panel-badge badge-deb">Debian .deb</span>
          </div>

          <div class="form-group">
            <label for="deb_version">Latest Version</label>
            <input type="text" id="deb_version" name="deb_version" value="<?= htmlspecialchars((string)($config['deb']['latest_version'] ?? '0.1.3')) ?>" required placeholder="0.1.4">
          </div>

          <div class="form-group">
            <label for="deb_download_url">Download URL (.deb)</label>
            <input type="text" id="deb_download_url" name="deb_download_url" value="<?= htmlspecialchars((string)($config['deb']['download_url'] ?? '')) ?>" placeholder="https://.../voice-assistant_0.1.4_amd64.deb">
          </div>

          <div class="form-group">
            <label for="deb_notes">Changelog / Release Notes</label>
            <textarea id="deb_notes" name="deb_notes" placeholder="Release notes for Debian/Ubuntu..."><?= htmlspecialchars((string)($config['deb']['release_notes'] ?? '')) ?></textarea>
          </div>

          <label class="checkbox-row">
            <input type="checkbox" name="deb_mandatory" <?= !empty($config['deb']['mandatory']) ? 'checked' : '' ?>>
            <span class="checkbox-label">Mandatory (Force update)</span>
          </label>
        </div>

        <!-- 3. Linux AppImage (.AppImage) Configuration -->
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <svg style="width: 18px; height: 18px; fill: var(--appimage-color);" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              <span>Linux AppImage</span>
            </div>
            <span class="panel-badge badge-appimage">Portable .AppImage</span>
          </div>

          <div class="form-group">
            <label for="appimage_version">Latest Version</label>
            <input type="text" id="appimage_version" name="appimage_version" value="<?= htmlspecialchars((string)($config['appimage']['latest_version'] ?? '0.1.3')) ?>" required placeholder="0.1.4">
          </div>

          <div class="form-group">
            <label for="appimage_download_url">Download URL (.AppImage)</label>
            <input type="text" id="appimage_download_url" name="appimage_download_url" value="<?= htmlspecialchars((string)($config['appimage']['download_url'] ?? '')) ?>" placeholder="https://.../Voice-Assistant-0.1.4.AppImage">
          </div>

          <div class="form-group">
            <label for="appimage_notes">Changelog / Release Notes</label>
            <textarea id="appimage_notes" name="appimage_notes" placeholder="Release notes for AppImage..."><?= htmlspecialchars((string)($config['appimage']['release_notes'] ?? '')) ?></textarea>
          </div>

          <label class="checkbox-row">
            <input type="checkbox" name="appimage_mandatory" <?= !empty($config['appimage']['mandatory']) ? 'checked' : '' ?>>
            <span class="checkbox-label">Mandatory (Force update)</span>
          </label>
        </div>
      </div>

      <div class="actions-bar">
        <span class="last-updated">Last saved: <strong><?= htmlspecialchars((string)($config['updated_at'] ?? 'Never')) ?></strong></span>
        <button type="submit" class="btn-primary">
          <svg style="width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2;" viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          <span>Save All Settings</span>
        </button>
      </div>
    </form>
  </div>

  <footer>
    Voice Assistant &bull; Standalone Single-File Multi-Target Update System
  </footer>
</body>
</html>
