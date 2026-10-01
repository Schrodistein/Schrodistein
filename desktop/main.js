/* Radar de Divisas — aplicación de escritorio (Electron).
 *
 * Envuelve la app web de ../trading con ventajas de escritorio:
 * - Se sirve desde un protocolo propio (radar://) con una política de
 *   seguridad de contenidos estricta; la página no tiene acceso a Node.
 * - Al cerrar la ventana sigue en la bandeja del sistema: el escáner y los
 *   avisos continúan funcionando mientras el ordenador esté encendido.
 * - Notificaciones del sistema que traen la ventana al frente, parpadeo en
 *   la barra de tareas e inicio opcional con el sistema.
 * - El calendario económico funciona aunque el proveedor no admita CORS.
 * - Los enlaces externos (Binance, TradingView…) se abren en el navegador. */
'use strict';
const { app, BrowserWindow, Tray, Menu, Notification, shell, protocol, net, nativeImage, session, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'radar';
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'trading') : path.join(__dirname, '..', 'trading');
const ICON = path.join(ROOT, 'icons', 'icon-512.png');
const isMac = process.platform === 'darwin';

const API_HOSTS = [
  'https://*.binance.vision', 'https://*.binance.com', 'wss://*.binance.vision', 'wss://stream.binance.com:9443',
  'https://api.twelvedata.com', 'https://api.frankfurter.dev', 'https://api.frankfurter.app', 'https://nfs.faireconomy.media',
];
// Canales de noticias (bancos centrales y FXStreet): solo se leen titulares.
const NEWS_HOSTS = ['https://www.federalreserve.gov', 'https://www.ecb.europa.eu', 'https://www.bankofengland.co.uk', 'https://www.boj.or.jp', 'https://www.fxstreet.com'];
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  'connect-src ' + API_HOSTS.concat(NEWS_HOSTS).join(' '),
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Carpeta de datos alternativa (pruebas automáticas).
if (process.env.RADAR_USER_DATA) app.setPath('userData', process.env.RADAR_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setAppUserModelId('com.schrodistein.radardivisas');

// Preferencias propias de la versión de escritorio.
const PREFS = path.join(app.getPath('userData'), 'escritorio.json');
let prefs = { closeToTray: true, trayHintShown: false };
try {
  prefs = Object.assign(prefs, JSON.parse(fs.readFileSync(PREFS, 'utf8')));
} catch (e) {
  /* primera ejecución */
}
const savePrefs = () => {
  try {
    fs.writeFileSync(PREFS, JSON.stringify(prefs));
  } catch (e) {
    /* sin permisos de escritura */
  }
};

let win = null;
let tray = null;
let quitting = false;

function show() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quit() {
  quitting = true;
  app.quit();
}

// Archivos de la app web servidos desde radar://app/…
function serve() {
  protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return new Response('No encontrado', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

// Algunos proveedores (calendario) no envían cabeceras CORS: en escritorio se añaden.
function allowCors() {
  const urls = ['https://nfs.faireconomy.media/*', 'https://api.frankfurter.dev/*', 'https://api.frankfurter.app/*', 'https://api.twelvedata.com/*'].concat(NEWS_HOSTS.map((h) => h + '/*'));
  session.defaultSession.webRequest.onHeadersReceived({ urls }, (details, cb) => {
    const headers = {};
    for (const k of Object.keys(details.responseHeaders || {})) if (!/^access-control-allow-origin$/i.test(k)) headers[k] = details.responseHeaders[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    cb({ responseHeaders: headers });
  });
  // La página solo puede pedir permiso de notificaciones (nada de cámara, micrófono, etc.).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'notifications'));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 380, minHeight: 560,
    title: 'Radar de Divisas', icon: ICON, backgroundColor: '#0d1117', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      // Que los temporizadores del escáner no se frenen con la ventana oculta.
      backgroundThrottling: false,
    },
  });
  win.loadURL(SCHEME + '://app/index.html');
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(SCHEME + '://')) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (e) => {
    if (quitting || !prefs.closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    if (!prefs.trayHintShown && Notification.isSupported()) {
      new Notification({ title: 'Radar de Divisas sigue activo', body: 'Los avisos seguirán llegando. Para cerrarlo del todo, usa «Salir» en el icono de la bandeja.', icon: ICON }).show();
      prefs.trayHintShown = true;
      savePrefs();
    }
  });
  win.on('closed', () => (win = null));
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('Radar de Divisas');
  const build = () =>
    Menu.buildFromTemplate([
      { label: 'Mostrar Radar de Divisas', click: show },
      { label: 'Ver señales', click: () => goTab('signals') },
      { label: 'Ver mercados', click: () => goTab('markets') },
      { type: 'separator' },
      {
        label: 'Seguir avisando al cerrar la ventana', type: 'checkbox', checked: prefs.closeToTray,
        click: (item) => {
          prefs.closeToTray = item.checked;
          savePrefs();
        },
      },
      {
        label: 'Iniciar con el sistema', type: 'checkbox', visible: process.platform !== 'linux',
        checked: process.platform !== 'linux' && app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      { type: 'separator' },
      { label: 'Salir', click: quit },
    ]);
  tray.setContextMenu(build());
  tray.on('click', show);
}

function goTab(tab) {
  show();
  if (win) win.webContents.send('radar:tab', tab);
}

function createMenu() {
  const about = () =>
    dialog.showMessageBox(win, {
      type: 'info', title: 'Acerca de Radar de Divisas', message: 'Radar de Divisas ' + app.getVersion(),
      detail: 'Análisis técnico y cuantitativo de divisas y de los mercados de Binance, con proyección del precio y avisos de entrada.\n\nDatos públicos de Binance, Twelve Data, el Banco Central Europeo y Forex Factory. La app no envía órdenes ni accede a tu cuenta. No constituye asesoramiento financiero.',
    });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu', label: 'Radar de Divisas' }] : []),
      {
        label: 'Archivo',
        submenu: [
          { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
          { type: 'separator' },
          { label: 'Cerrar ventana', accelerator: 'CmdOrCtrl+W', click: () => win && win.close() },
          { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: quit },
        ],
      },
      {
        label: 'Edición',
        submenu: [
          { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' },
          { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
        ],
      },
      {
        label: 'Ver',
        submenu: [
          { role: 'resetZoom', label: 'Tamaño real' }, { role: 'zoomIn', label: 'Ampliar' }, { role: 'zoomOut', label: 'Reducir' },
          { type: 'separator' }, { role: 'togglefullscreen', label: 'Pantalla completa' }, { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        ],
      },
      {
        label: 'Ir a',
        submenu: [
          ['signals', 'Señales'], ['markets', 'Mercados'], ['prospect', 'Prospecto'], ['projection', 'Proyección'], ['forex', 'Divisas'],
          ['scanner', 'Escáner'], ['backtest', 'Backtest'], ['risk', 'Riesgo'],
        ].map(([tab, label], k) => ({ label, accelerator: 'CmdOrCtrl+' + (k + 1), click: () => goTab(tab) })),
      },
      { label: 'Ayuda', submenu: [{ label: 'Acerca de Radar de Divisas', click: about }] },
    ])
  );
}

// Mensajes de la página (preload.js).
ipcMain.on('radar:show', show);
ipcMain.on('radar:alert', (e, title) => {
  if (tray) tray.setToolTip('Radar de Divisas · ' + String(title).slice(0, 100));
  if (win && !win.isFocused()) win.flashFrame(true);
  if (isMac && app.dock) app.dock.bounce('informational');
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    serve();
    allowCors();
    createMenu();
    createWindow();
    try {
      createTray();
    } catch (e) {
      tray = null; // sin bandeja (algunos escritorios Linux): cerrar la ventana cierra la app
    }
    app.on('activate', show);
  });
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
}
