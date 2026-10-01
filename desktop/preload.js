/* Puente mínimo entre la página y la app de escritorio: la página no tiene
 * acceso a Node; solo puede pedir que se muestre la ventana o señalar un aviso. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radarDesktop', {
  platform: process.platform,
  show: () => ipcRenderer.send('radar:show'),
  alert: (title) => ipcRenderer.send('radar:alert', String(title || '').slice(0, 200)),
});
