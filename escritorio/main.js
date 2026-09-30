/* Frontera Eficiente — aplicación de escritorio (Electron).
 * Reutiliza la app web de portafolios y le añade:
 *   - actualización diaria de cierres y noticias de los activos de la BVC,
 *   - una ventana con el sitio de la BVC que captura sus descargas (CSV/Excel),
 *   - importación de archivos, almacenamiento local, avisos y bandeja del sistema. */
'use strict';
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification, dialog, nativeImage, session, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const updater = require('./lib/updater');

if (process.env.FE_USERDATA) app.setPath('userData', process.env.FE_USERDATA);
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let bvcWin = null;
let tray = null;
let store = null;
let timer = null;
let running = null;
let quitting = false;

const log = (...a) => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'registro.log'), `${new Date().toISOString()} ${a.join(' ')}\n`);
  } catch (e) {
    /* sin registro */
  }
};

/* fetch real, o respuestas grabadas para las pruebas (FE_FIXTURES). */
function getFetch() {
  const dir = process.env.FE_FIXTURES;
  if (!dir) return globalThis.fetch;
  return async (url) => {
    const u = new URL(url);
    let file = null;
    if (u.hostname.includes('yahoo')) file = path.join(dir, 'yahoo-' + decodeURIComponent(u.pathname.split('/').pop()) + '.json');
    else if (u.hostname.includes('news.google')) file = path.join(dir, 'news.xml');
    const ok = file && fs.existsSync(file);
    const body = ok ? fs.readFileSync(file, 'utf8') : JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } });
    return { ok, status: ok ? 200 : 404, json: async () => JSON.parse(body), text: async () => body };
  };
}

// Los libros de Excel se leen en la interfaz (sección Datos); la BVC entrega CSV.
const readExcel = null;

const icon = (name) => nativeImage.createFromPath(path.join(__dirname, 'build', name));

function broadcast(extra) {
  const payload = Object.assign({ summary: store.summary() }, extra);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('datos:actualizados', payload);
}

function notify(title, body) {
  if (!store.data.settings.notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png') });
  n.on('click', () => showWindow());
  n.show();
}

/* Una actualización a la vez; las llamadas simultáneas esperan la misma. */
function runUpdate(reason) {
  if (running) return running;
  running = (async () => {
    const fetch = getFetch();
    const prices = await updater.updatePrices(store, fetch, log);
    const news = await updater.updateNews(store, fetch, log);
    store.save();
    log(`actualización (${reason}): ${prices.updated.length} activos con cierres nuevos, ${news.fresh.length} noticias nuevas, ${prices.errors.length + news.errors.length} errores`);
    if (reason !== 'manual') {
      if (prices.updated.length) notify('Cierres actualizados', `${prices.updated.length} activos con datos nuevos${prices.newest ? `; último cierre del ${prices.newest}` : ''}.`);
      if (news.fresh.length) notify('Noticias nuevas', `${news.fresh.length} noticias de ${[...new Set(news.fresh.map((n) => n.asset))].slice(0, 4).join(', ')}.`);
    }
    const result = { prices: { updated: prices.updated, errors: prices.errors, newest: prices.newest }, news: { fresh: news.fresh.length, errors: news.errors } };
    broadcast({ result });
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

function schedule() {
  clearInterval(timer);
  const s = store.data.settings;
  if (!s.auto) return;
  const every = Math.max(1, s.intervalHours) * 36e5;
  timer = setInterval(() => runUpdate('programada'), every);
  const last = Date.parse(store.data.meta.lastPrices || 0) || 0;
  if (Date.now() - last > every) setTimeout(() => runUpdate('al abrir'), 4000);
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function safeExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    title: 'Frontera Eficiente',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f1f4f2',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'portafolios', 'index.html'), { hash: 'frontera' });
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      safeExternal(url);
    }
  });
  win.on('close', (e) => {
    if (!quitting && store.data.settings.background && tray) {
      e.preventDefault();
      win.hide();
    }
  });
}

/* Ventana con el sitio de la BVC: cada archivo que se descarga ahí se importa solo. */
function openBvc() {
  if (bvcWin && !bvcWin.isDestroyed()) return bvcWin.focus();
  bvcWin = new BrowserWindow({
    width: 1240,
    height: 860,
    title: 'BVC · las descargas se importan solas',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  bvcWin.removeMenu();
  bvcWin.loadURL('https://www.bvc.com.co/renta-variable-mercado-local');
  bvcWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*bvc\.com\.co\//i.test(url)) bvcWin.loadURL(url);
    else safeExternal(url);
    return { action: 'deny' };
  });
}

function handleDownloads() {
  session.defaultSession.on('will-download', (e, item) => {
    const dir = path.join(app.getPath('userData'), 'descargas');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${item.getFilename()}`);
    item.setSavePath(file);
    item.once('done', (ev, state) => {
      if (state !== 'completed') return;
      const r = updater.importFiles(store, [file], readExcel);
      store.save();
      const names = Object.keys(r.assets);
      if (names.length) notify('Datos de la BVC importados', names.map((n) => `${n}: ${r.assets[n]} días`).join(', '));
      else if (r.errors.length) notify('No se pudo importar la descarga', r.errors[0]);
      broadcast({ imported: r });
    });
  });
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(icon('tray.png'));
  } catch (e) {
    tray = null;
    return;
  }
  tray.setToolTip('Frontera Eficiente');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Frontera Eficiente', click: showWindow },
      { label: 'Actualizar ahora', click: () => runUpdate('manual') },
      { label: 'Abrir la BVC', click: openBvc },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', showWindow);
}

function applyLogin() {
  if (process.platform === 'linux' || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.data.settings.openAtLogin, openAsHidden: true, args: ['--oculta'] });
}

function registerIpc() {
  ipcMain.handle('datos:resumen', () => store.summary());
  ipcMain.handle('datos:series', () => store.series());
  ipcMain.handle('datos:noticias', () => store.data.news);
  ipcMain.handle('datos:actualizar', () => runUpdate('manual'));
  ipcMain.handle('datos:importar', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importar históricos de la BVC',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'CSV o Excel', extensions: ['csv', 'txt', 'xlsx', 'xls', 'ods'] }, { name: 'Todos', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const res = updater.importFiles(store, r.filePaths, readExcel);
    store.save();
    broadcast({ imported: res });
    return res;
  });
  ipcMain.handle('bvc:abrir', () => {
    openBvc();
    return true;
  });
  ipcMain.handle('ajustes:guardar', (e, patch) => {
    const s = store.data.settings;
    for (const k of Object.keys(patch || {})) if (k in s && typeof patch[k] === typeof s[k]) s[k] = patch[k];
    s.intervalHours = Math.min(24, Math.max(1, Math.round(s.intervalHours)));
    store.save();
    applyLogin();
    schedule();
    if (!s.background && win && !win.isVisible()) showWindow();
    return store.summary();
  });
  ipcMain.handle('activos:guardar', (e, list) => {
    if (!Array.isArray(list)) return store.summary();
    const clean = list
      .map((a) => ({ name: String(a.name || '').trim().toUpperCase().slice(0, 40), yahoo: String(a.yahoo || '').trim().toUpperCase().slice(0, 40), news: String(a.news || '').trim().slice(0, 120), index: !!a.index, enabled: a.enabled !== false }))
      .filter((a, i, arr) => a.name && arr.findIndex((b) => b.name === a.name) === i);
    const keep = new Set(clean.map((a) => a.name));
    store.data.assets = clean;
    for (const k of Object.keys(store.data.prices)) if (!keep.has(k)) delete store.data.prices[k];
    for (const k of Object.keys(store.data.meta.errors)) if (!keep.has(k)) delete store.data.meta.errors[k];
    store.save();
    broadcast({});
    return store.summary();
  });
  ipcMain.handle('abrir-enlace', (e, url) => safeExternal(String(url)));
  ipcMain.handle('app:version', () => app.getVersion());
}

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});
app.on('activate', showWindow);
app.on('window-all-closed', () => {
  if (!tray || !store.data.settings.background) app.quit();
});

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  registerIpc();
  handleDownloads();
  createTray();
  applyLogin();
  if (!process.argv.includes('--oculta')) createWindow();
  schedule();
  powerMonitor.on('resume', () => {
    const last = Date.parse(store.data.meta.lastPrices || 0) || 0;
    if (store.data.settings.auto && Date.now() - last > store.data.settings.intervalHours * 36e5) runUpdate('al reanudar');
  });
});
