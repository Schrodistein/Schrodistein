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
const macro = require('./lib/macro');
const biblioteca = require('./lib/biblioteca');

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
    else if (u.hostname.includes('fred')) file = path.join(dir, 'fred-' + u.searchParams.get('id') + '.csv');
    else if (u.hostname.includes('worldbank')) file = path.join(dir, 'wb-' + u.pathname.split('/')[5] + '.json');
    else if (u.hostname.includes('datos.gov.co')) file = path.join(dir, 'socrata-trm.json');
    else if (u.hostname.includes('stern.nyu.edu')) file = path.join(dir, 'damodaran.xls');
    const ok = file && fs.existsSync(file);
    const raw = ok ? fs.readFileSync(file) : Buffer.from(JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }));
    const body = raw.toString('utf8');
    return { ok, status: ok ? 200 : 404, json: async () => JSON.parse(body), text: async () => body, arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) };
  };
}

// Los libros de Excel se leen en la interfaz (sección Datos); la BVC entrega CSV.
const readExcel = null;

/* Biblioteca local: Documentos/Frontera Eficiente/Biblioteca (o FE_LIBRARY en las pruebas). */
let lastDocs = null;
function libraryDir() {
  if (process.env.FE_LIBRARY) return process.env.FE_LIBRARY;
  if (store.data.settings.libraryDir) return store.data.settings.libraryDir;
  if (process.env.FE_USERDATA) return path.join(app.getPath('userData'), 'Biblioteca');
  return path.join(app.getPath('documents'), 'Frontera Eficiente', 'Biblioteca');
}
function writeLibrary(docs) {
  if (docs) lastDocs = docs;
  try {
    return biblioteca.write(store, libraryDir(), lastDocs);
  } catch (e) {
    log('biblioteca', e.message);
    return { error: e.message, dir: libraryDir() };
  }
}

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
    const mac = await macro.updateMacro(store, fetch, updater.loadPF(), log);
    store.save();
    writeLibrary();
    log(`actualización (${reason}): ${prices.updated.length} activos con cierres nuevos, ${news.fresh.length} noticias nuevas, ${prices.errors.length + news.errors.length} errores`);
    if (reason !== 'manual') {
      if (mac.updated.length) notify('Variables macro actualizadas', mac.updated.map((k) => updater.loadPF().macro.VARS[k].label).join(', '));
      if (news.fresh.length) notify('Noticias nuevas', `${news.fresh.length} noticias de ${[...new Set(news.fresh.map((n) => n.asset))].slice(0, 4).join(', ')}.`);
    }
    const result = { prices: { updated: prices.updated, errors: prices.errors, newest: prices.newest }, news: { fresh: news.fresh.length, errors: news.errors }, macro: mac };
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
  session.defaultSession.on('will-download', (e, item, wc) => {
    // Solo se importan las descargas de la ventana de la BVC; las demás (el libro de
    // Excel o los CSV que genera la app) se guardan donde elija el usuario.
    if (!bvcWin || bvcWin.isDestroyed() || wc !== bvcWin.webContents) return;
    const dir = path.join(app.getPath('userData'), 'descargas');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${item.getFilename()}`);
    item.setSavePath(file);
    item.once('done', (ev, state) => {
      if (state !== 'completed') return;
      const r = updater.importFiles(store, [file], readExcel);
      store.save();
      biblioteca.saveOriginal(libraryDir(), file);
      writeLibrary();
      const names = Object.keys(r.assets);
      if (!names.length && r.errors.length) notify('No se pudo importar la descarga', r.errors[0]);
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
  ipcMain.handle('datos:series', (e, source) => store.series(source === 'todos' ? 'todos' : 'cargados'));
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
    for (const f of r.filePaths) biblioteca.saveOriginal(libraryDir(), f);
    writeLibrary();
    broadcast({ imported: res });
    return res;
  });
  ipcMain.handle('datos:exportar', async () => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Exportar mis datos',
      defaultPath: `frontera-eficiente-datos-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Respaldo de Frontera Eficiente', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.exportData()));
    return { file: r.filePath, assets: store.data.assets.length };
  });
  ipcMain.handle('datos:importar-respaldo', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importar datos de otro equipo', properties: ['openFile'], filters: [{ name: 'Respaldo de Frontera Eficiente', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const res = store.importData(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
    store.save();
    broadcast({ restored: res });
    return res;
  });
  ipcMain.handle('bvc:abrir', () => {
    openBvc();
    return true;
  });
  ipcMain.handle('ajustes:guardar', (e, patch) => {
    const s = store.data.settings;
    for (const k of Object.keys(patch || {})) if (k in s && typeof patch[k] === typeof s[k]) s[k] = patch[k];
    s.intervalHours = Math.min(168, Math.max(1, Math.round(s.intervalHours)));
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
  ipcMain.handle('macro:datos', () => store.data.macro || {});
  ipcMain.handle('macro:actualizar', async () => {
    const r = await macro.updateMacro(store, getFetch(), updater.loadPF(), log);
    store.save();
    writeLibrary();
    return { result: r, data: store.data.macro };
  });
  ipcMain.handle('damodaran:descargar', async () => {
    const buf = await macro.fetchDamodaran(getFetch());
    const d = path.join(libraryDir(), 'damodaran');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'betaemerg.xls'), buf);
    return { base64: buf.toString('base64'), file: 'betaemerg.xls (mercados emergentes)', date: new Date().toISOString().slice(0, 10) };
  });
  ipcMain.handle('biblioteca:guardar', (e, docs) => writeLibrary(Array.isArray(docs) ? docs.slice(0, 20) : null));
  ipcMain.handle('biblioteca:abrir', async () => {
    const r = writeLibrary();
    await shell.openPath(r.dir || libraryDir());
    return r;
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
