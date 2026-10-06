/* Puente seguro entre la interfaz y el proceso principal: solo estas funciones. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bvc', {
  resumen: () => ipcRenderer.invoke('datos:resumen'),
  series: (source) => ipcRenderer.invoke('datos:series', source),
  noticias: () => ipcRenderer.invoke('datos:noticias'),
  actualizar: () => ipcRenderer.invoke('datos:actualizar'),
  importar: () => ipcRenderer.invoke('datos:importar'),
  exportarDatos: () => ipcRenderer.invoke('datos:exportar'),
  importarRespaldo: () => ipcRenderer.invoke('datos:importar-respaldo'),
  limpiarCache: () => ipcRenderer.invoke('cache:limpiar'),
  borrarTodo: () => ipcRenderer.invoke('datos:borrar-todo'),
  guardarAjustes: (p) => ipcRenderer.invoke('ajustes:guardar', p),
  guardarActivos: (l) => ipcRenderer.invoke('activos:guardar', l),
  abrirEnlace: (u) => ipcRenderer.invoke('abrir-enlace', u),
  version: () => ipcRenderer.invoke('app:version'),
  macro: () => ipcRenderer.invoke('macro:datos'),
  actualizarMacro: () => ipcRenderer.invoke('macro:actualizar'),
  damodaran: () => ipcRenderer.invoke('damodaran:descargar'),
  guardarBiblioteca: (docs) => ipcRenderer.invoke('biblioteca:guardar', docs),
  abrirBiblioteca: () => ipcRenderer.invoke('biblioteca:abrir'),
  alActualizar: (cb) => {
    ipcRenderer.removeAllListeners('datos:actualizados');
    ipcRenderer.on('datos:actualizados', (_e, d) => cb(d));
  },
});
