/* Copia la app web (../portafolios, sin sus pruebas) dentro de la app de escritorio. */
'use strict';
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', '..', 'portafolios');
const to = path.join(__dirname, '..', 'portafolios');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
fs.rmSync(path.join(to, 'tests'), { recursive: true, force: true });
console.log('Interfaz copiada en', to);
