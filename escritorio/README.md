# Frontera Eficiente para escritorio

Aplicación instalable (Windows, macOS y Linux) de Frontera Eficiente. Incluye todo el análisis de la app web: Markowitz, Sharpe, Treynor y Jensen, confirmación de portafolios y compras por acciones y fecha. Además se conecta a internet para alimentarse día a día:

Autor de la aplicación: **Schrödistein**. La teoría y los modelos que usa son de sus autores (Markowitz, Tobin, Sharpe, Lintner, Treynor, Jensen, Treynor y Black, Damodaran y los demás), citados en la app con sus referencias.

- **Carga manual de los históricos de la BVC**: descarga los archivos en bvc.com.co (acciones y ETF en tramos de 6 meses; índices como el MSCI COLCAP por trimestre) y cárgalos con Mercado → «Importar archivos de la BVC» o en Datos. Los tramos de un mismo activo se unen solos. (La descarga directa desde la app se quitó en la versión 2.3.)
- Las descargas de la BVC se guardan con su nombre original (antes se les anteponía la hora y aparecían activos como «1790829309508-COLTES LP»); los que quedaron así se unen solos al abrir. La versión instalada se ve al pie de la app.
- **Al desinstalar se borra todo lo que la app guardó**: en Windows (instalador) y Linux (.deb), el desinstalador borra los datos de la app, la caché, la biblioteca local (Documentos/Frontera Eficiente) y el inicio automático; al actualizar a una versión nueva no se borra nada. En macOS, la versión portátil de Windows y AppImage, que no tienen desinstalador, usa **«Borrar todos mis datos»** en Mercado antes de borrar la app.
- **Limpiar caché** (Mercado): borra la caché del navegador interno y los archivos temporales de las descargas ya importadas; los temporales también se borran solos al abrir. No toca tus datos ni la biblioteca.
- **Catálogo de la BVC**: la lista trae todas las acciones y ETF locales, los índices de referencia y el dólar y el euro. **Los precios de acciones, índices y ETF salen solo de la BVC**; los históricos se cargan a mano (ver arriba) y quedan en la biblioteca local.
- **Mercado**: cierres diarios de los activos que sigues. Tienen prioridad los datos oficiales de la Bolsa de Valores de Colombia:
  - **Importar archivos de la BVC** carga CSV ya descargados, por ejemplo los tramos de 6 meses de cada acción.
  - **Actualización automática**: solo para las divisas (dólar y euro), que no se negocian en la BVC. Las acciones, índices y ETF no usan ninguna fuente distinta de la BVC; al actualizar a esta versión se borran los cierres automáticos que se hubieran guardado antes y se conservan los de la BVC.
- **Noticias**: titulares recientes de Google News (español, Colombia) para cada activo y para la BVC. Se abren en el navegador.
- Se actualiza al abrir y cada hora, día o **semana** (lo predeterminado), avisa cuando se actualizan las variables macro (no avisa de noticias) y, si los datos nuevos cambian el **portafolio recomendado**, lo recalcula y avisa con la nueva composición. Puede seguir en la bandeja del sistema y abrirse al iniciar sesión.
- Además de acciones: TES, bonos y CDT (por precio o por tasa), divisas (el dólar USD/COP se descarga solo), futuros y opciones. Trae en la lista los índices de referencia de cada segmento: MSCI COLCAP, COLTES y COLIBR (estos dos se importan desde la BVC).
- El análisis, la recomendación, la biblioteca y la matriz de precios usan solo los precios de la BVC (descargas e importaciones).
- **Comprar**, **Dónde invertir** y **Descargas** funcionan igual que en la app web: plan de inversión por presupuesto y horizonte con comisiones editables (promociones incluidas), montos mínimos y renta fija; canales y paso a paso para invertir; y libro de Excel con todos los cálculos (se guarda donde elijas).
- **Variables macro**: descarga PIB, inflación, desempleo y TRM de Colombia: la TRM diaria de datos.gov.co, la inflación y el desempleo mensuales y el PIB trimestral de FRED (OCDE) y, como respaldo, las series anuales del Banco Mundial. Las actualiza con los cierres.
- **Betas de Damodaran**: descarga el archivo de betas por industria de mercados emergentes de NYU Stern para comparar la beta de Damodaran con la de Sharpe.
- **Biblioteca local** en `Documentos/Frontera Eficiente/Biblioteca`, que se reescribe en cada actualización:
  - un solo CSV por acción, ETF o índice con todo su historial, en formato de Excel en español (punto y coma, punto de miles y coma decimal), con los días en que se negoció: los tramos de 6 meses que descarga la BVC se unen y el archivo temporal de cada descarga se borra al importarlo;
  - `Matriz de precios.xlsx`, con la hoja «M. PRECIOS» (una fila por rueda de la BVC; si un activo no se negoció en una rueda, lleva su último precio cotizado);
  - las variables macro con su fuente;
  - el archivo de Damodaran (se descarga solo en cada actualización semanal);
  - los documentos «Paso a paso», «Variables macro» y «Teoría» en HTML.
  Se abre con Mercado → «Abrir biblioteca local».
- Los datos se guardan en el equipo (`datos.json` en la carpeta de datos de la app); no se envían a ningún servidor.

## Compartir la app

Cada instalador es la aplicación completa y funciona en cualquier equipo sin una versión anterior. En Windows hay dos opciones: el instalador (`…-win-x64-instalador.exe`) y la versión portátil (`…-win-x64-portable.exe`), que se abre sin instalar. Para llevar tus datos cargados a otro equipo: **Mercado → Exportar mis datos** y, en el otro equipo, **Importar datos de otro equipo**.

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
lib/sources.js  divisas (Yahoo Finance) y noticias (Google News RSS)
lib/updater.js  actualización diaria e importación de archivos de la BVC
../portafolios  interfaz y motor de cálculo (se copia al compilar); js/desktop.js añade Mercado y Noticias
```
