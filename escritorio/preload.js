/* Puente seguro entre la interfaz y el proceso principal: solo estas funciones. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bvc', {
  resumen: () => ipcRenderer.invoke('datos:resumen'),
  series: (source) => ipcRenderer.invoke('datos:series', source),
  noticias: () => ipcRenderer.invoke('datos:noticias'),
  actualizar: () => ipcRenderer.invoke('datos:actualizar'),
  importar: () => ipcRenderer.invoke('datos:importar'),
  abrirBVC: () => ipcRenderer.invoke('bvc:abrir'),
  guardarAjustes: (p) => ipcRenderer.invoke('ajustes:guardar', p),
  guardarActivos: (l) => ipcRenderer.invoke('activos:guardar', l),
  abrirEnlace: (u) => ipcRenderer.invoke('abrir-enlace', u),
  version: () => ipcRenderer.invoke('app:version'),
  alActualizar: (cb) => {
    ipcRenderer.removeAllListeners('datos:actualizados');
    ipcRenderer.on('datos:actualizados', (_e, d) => cb(d));
  },
});
