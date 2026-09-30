# Frontera Eficiente para escritorio

Aplicación instalable (Windows, macOS y Linux) de Frontera Eficiente. Incluye todo el análisis de la app web: Markowitz, Sharpe, Treynor y Jensen, confirmación de portafolios y compras por acciones y fecha. Además se conecta a internet para alimentarse día a día:

- **Mercado**: cierres diarios de los activos que sigues. Tienen prioridad los datos oficiales de la Bolsa de Valores de Colombia:
  - **Abrir la BVC y descargar** abre el sitio de la BVC dentro de la app. Cada histórico que descargas ahí (CSV) se importa y se une solo.
  - **Importar archivos de la BVC** carga CSV ya descargados, por ejemplo los tramos de 6 meses de cada acción.
  - **Actualización automática**: la BVC no ofrece una conexión abierta para aplicaciones, así que la app toma los cierres diarios de Yahoo Finance con el símbolo de cada activo (las acciones de la BVC llevan el sufijo `.CL`). Esos cierres nunca reemplazan un cierre descargado de la BVC. Se puede apagar o cambiar el símbolo de cada activo.
- **Noticias**: titulares recientes de Google News (español, Colombia) para cada activo y para la BVC. Se abren en el navegador.
- Se actualiza al abrir y cada 1 a 24 horas, avisa de cierres y noticias nuevas, y puede seguir en la bandeja del sistema y abrirse al iniciar sesión.
- El análisis y la recomendación usan por defecto solo los datos que cargaste de la BVC (descargas e importaciones); en Mercado se puede incluir también la fuente automática.
- **Comprar** y **Descargas** funcionan igual que en la app web: plan de compra con comisiones de trii y libro de Excel con todos los cálculos (se guarda donde elijas).
- Los datos se guardan en el equipo (`datos.json` en la carpeta de datos de la app); no se envían a ningún servidor.

## Descargar

Los instaladores se compilan en GitHub Actions (`.github/workflows/escritorio.yml`) y se publican en la *Release* `escritorio-v<versión>` del repositorio. No están firmados con un certificado de desarrollador: la Release explica cómo abrirlos en cada sistema.

## Desarrollo

```bash
cd escritorio
npm install          # instala Electron y electron-builder
npm start            # copia ../portafolios y abre la app
npm test             # pruebas del proceso principal (sin red)
xvfb-run npm run e2e # prueba de extremo a extremo con Playwright y respuestas grabadas
npm run dist         # instaladores para el sistema actual en dist/
```

```
main.js         proceso principal: ventana, bandeja, programación, ventana de la BVC, IPC
preload.js      puente seguro con la interfaz (window.bvc)
lib/store.js    almacén local: activos, precios por fecha y fuente, noticias, ajustes
lib/sources.js  cierres (Yahoo Finance) y noticias (Google News RSS)
lib/updater.js  actualización diaria e importación de archivos de la BVC
../portafolios  interfaz y motor de cálculo (se copia al compilar); js/desktop.js añade Mercado y Noticias
```
