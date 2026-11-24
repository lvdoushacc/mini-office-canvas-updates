const { app, BrowserWindow, session, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// 单实例锁：保证同一时间只存在一个桌面外壳实例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8900;
const PYTHON = path.join(ROOT_DIR, 'python', 'python.exe');
const SERVER = path.join(ROOT_DIR, 'server.py');
const RUNTIME_DIR = path.join(ROOT_DIR, 'data', 'runtime');
const LOG_FILE = path.join(RUNTIME_DIR, 'desktop-shell.log');

function readAppVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'VERSION.json'), 'utf8'));
    const version = String(data.version || '').trim();
    return version || '未知版本';
  } catch (_) {
    return '未知版本';
  }
}

const APP_VERSION = readAppVersion();

let mainWindow = null;
let backend = null;
let startedBackend = false;

function appendLog(message) {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (_) {}
}

function isHealthy() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${PORT}/api/health`, { timeout: 800 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(response.statusCode === 200 && data.app === 'xxpd');
        } catch (_) {
          resolve(false);
        }
      });
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

async function waitForBackend() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await isHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function startBackend() {
  if (await isHealthy()) {
    appendLog(`复用已经运行的小小办公服务，版本：${APP_VERSION}`);
    return true;
  }
  if (!fs.existsSync(PYTHON) || !fs.existsSync(SERVER)) {
    throw new Error('缺少便携 Python 或 server.py');
  }
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const output = fs.openSync(LOG_FILE, 'a');
  backend = spawn(PYTHON, [SERVER], {
    cwd: ROOT_DIR,
    windowsHide: true,
    detached: false,
    stdio: ['ignore', output, output],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  startedBackend = true;
  backend.on('error', (error) => appendLog(`后端启动错误：${error.message}`));
  backend.on('exit', (code, signal) => appendLog(`后端退出：code=${code ?? ''}, signal=${signal ?? ''}`));
  const ready = await waitForBackend();
  if (!ready) throw new Error(`后端未在 ${PORT} 端口就绪，请查看 ${LOG_FILE}`);
  return true;
}

function stopBackend() {
  try {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/app/client-closed?client_id=desktop_shell',
      method: 'POST',
      timeout: 500,
    });
    req.on('error', () => {});
    req.end();
  } catch (_) {}

  if (!startedBackend || !backend || backend.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backend.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    } else {
      backend.kill('SIGTERM');
    }
  } catch (_) {}
  backend = null;
}

function registerWindowControls() {
  ipcMain.on('desktop-window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.on('desktop-window:toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('desktop-window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.handle('desktop-window:is-maximized', () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()));
}

async function createWindow() {
  await startBackend();
  const appSession = session.fromPartition('persist:xxpd-desktop');
  const iconPath = path.join(ROOT_DIR, 'static', 'images', 'logo.ico');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    title: `小小办公 v${APP_VERSION}`,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0d0e11',
    frame: false,
    transparent: false,
    hasShadow: true,
    autoHideMenuBar: true,
    webPreferences: {
      session: appSession,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const sendMaximizedState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop-window:maximized-changed', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaximizedState);
  mainWindow.on('unmaximize', sendMaximizedState);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.key === 'F5') || (input.control && (input.key === 'r' || input.key === 'R'))) {
      event.preventDefault();
      try {
        mainWindow.webContents.reloadIgnoringCache();
      } catch (_) {}
    }
  });
  const cacheBust = Date.now();
  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/?desktop=1&v=${cacheBust}`);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.flashFrame(true);
    try {
      mainWindow.webContents.reloadIgnoringCache();
    } catch (_) {}
  }
});

app.whenReady().then(async () => {
  try {
    registerWindowControls();
    await createWindow();
  } catch (error) {
    appendLog(`桌面窗口启动失败：${error.stack || error.message}`);
    dialog.showErrorBox(`小小办公 v${APP_VERSION} 启动失败`, `${error.message}\n\n日志：${LOG_FILE}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', stopBackend);
