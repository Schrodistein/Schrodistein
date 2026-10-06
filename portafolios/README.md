# Frontera Eficiente

Aplicación web para construir y **confirmar portafolios eficientes** con la teoría de Markowitz, Sharpe, Treynor y Jensen. Muestra el rendimiento esperado del portafolio y lo diversifica. Combina renta variable, renta fija, derivados y divisas, cada segmento medido contra su propio índice, y arma un plan de inversión para un presupuesto y un horizonte con comisiones y montos mínimos. No tiene dependencias y todo se calcula en el navegador. Solo al subir un Excel descarga SheetJS desde cdnjs.

Ábrela con `portafolios/index.html` (o con `npm start` en `http://localhost:8080/portafolios/`).

Autor de la aplicación: **Schrödinstein**. La teoría y los modelos que usa son de sus autores (Markowitz, Tobin, Sharpe, Lintner, Treynor, Jensen, Treynor y Black, Damodaran y los demás), citados en la app con sus referencias.

## Qué hace

**Versión 2.4**
- La app arranca vacía: la biblioteca se llena con los archivos que subes (históricos de la BVC, series del **Banco de la República** y del DANE, tasas de los TES, FRED, EMBIG y los documentos de Damodaran). En la app de escritorio, la actualización de Mercado (divisas, noticias y macro) empieza después de que cargas tus archivos.
- Macro lee los Excel del Banco de la República tal como se descargan de su sistema: elige la serie por su nombre (por ejemplo «Tasa de desempleo – Total Nacional» entre seis), omite los valores ausentes y convierte el PIB en niveles a crecimiento anual. Avisa si un archivo trae índices de tasa de cambio real (ITCR) en lugar de la TRM.

**Versión 2.3**
- Macro: importa los boletines del DANE en **PDF** (la app encuentra la cifra, por ejemplo «En el segundo trimestre de 2025 … crece 2,1 %», y la muestra con su frase para revisarla antes de guardar), anexos en **Excel** (trimestres 2025-I, meses ene-25, fechas de Excel) y CSV; cada variable muestra el enlace a su información oficial (DANE, Banco de la República, Superintendencia Financiera).
- Los históricos de la BVC se cargan solo a mano (se quitó la descarga directa). Sin avisos de noticias.
- App de escritorio: al desinstalar se borra todo lo que guardó; botón «Borrar todos mis datos»; «Limpiar caché».

**Versión 2.2**
- App de escritorio: descarga directa de la BVC aprendida de una descarga manual (acciones y ETF por semestre, índices por trimestre), al abrir la app.
- Un solo activo por nemotécnico también para las descargas con número delante del nombre; la biblioteca une los duplicados cada vez que se actualiza.

**Versión 2.1.2**
- Rendimientos siempre logarítmicos, rₜ = ln(Pₜ / Pₜ₋₁), también en la Terminal y en Mercado: variación del día, rendimiento a 1 año, desempeño por periodo y rendimiento acumulado ln(Pₜ / P₀) = Σ rₜ, que reemplaza la «base 100».

**Versión 2.1**
- **Cómo se elige cada portafolio, en detalle** (Paso a paso, 11.1 a 11.10): la frontera eficiente y la separación de Tobin; para cada portafolio (mínima varianza, máximo rendimiento, tangente, recomendado, máxima diversificación, paridad de riesgo, 1/N y Treynor-Black) su teoría y autores, el problema que resuelve, el cálculo paso a paso, el resultado con tus datos (qué activos entran y cuáles quedan fuera, con sus pesos) y cuándo usarlo; una guía para elegir y las referencias.

**Versión 2.0**
- **Terminal por segmento**: renta variable (acciones, ETF e índices de acciones, frente al MSCI COLCAP), renta fija (TES, bonos, CDT, COLTES y COLIBR, frente al COLTES) y divisas (dólar y euro, frente al USD/COP o la TRM), cada una con su lista, su ficha, sus gráficas y su mapa de correlaciones.
- **Cotizaciones diarias, siempre**: el análisis usa cada rueda de la BVC y anualiza con 242 ruedas; no se agrupan por semana ni por mes.
- **Datos y guía** en una sola pestaña; sin pestaña Comprar (los pesos salen de Portafolio y las compras se registran en Confirmar).
- Flechas para desplazar la barra de menús cuando no cabe en la pantalla.

- **Guía** (segunda pestaña): manual para aprender a operar acciones y ETF en la BVC, en 10 capítulos (qué se negocia, objetivo y riesgo, abrir la cuenta, órdenes y liquidación, datos, análisis de cada activo, construir el portafolio, pasar a las órdenes, seguimiento e impuestos, errores comunes), cada uno con la teoría que lo sostiene (Fama, Tobin, Roy, Markowitz, Sharpe, Lintner, Treynor y Black, Gordon, Chen, Roll y Ross, Kahneman y Tversky), ejemplos con tus datos, botones a la sección donde se practica, glosario y referencias.
- **Activos del portafolio** (Portafolio y Datos): elige cualquier grupo de dos o más activos; la frontera, los portafolios, el paso a paso y el plan se recalculan solo con ellos.
- **Catálogo de la BVC** (Biblioteca): las acciones y ETF locales, los índices de referencia y las divisas, con lo que ya está guardado y lo que falta. La app de escritorio abre la BVC para descargar los que faltan e importa cada archivo a la biblioteca.
- **Paso a paso de la frontera eficiente** (secciones 8 a 14): el problema de optimización y los puntos calculados, cómo se grafica la frontera, la CML y la SML, el criterio de cada portafolio (mínima varianza, máximo rendimiento, máxima Sharpe o tangente, recomendado, máxima diversificación, paridad de riesgo, pesos iguales, Treynor-Black), por qué cada activo entra o no al tangente, dónde queda el portafolio elegido y cómo se promedian las correlaciones (simple y ponderada o implícita).
- **Matriz de precios para Excel** (Biblioteca): libro .xlsx con la hoja «M. PRECIOS» (ITEM, FECHA, índice de mercado y una columna por acción o ETF, de la fecha más reciente a la más antigua, fechas m/d/aaaa y precios #,##0.00). Una fila por **rueda de la BVC** (días en que se negoció al menos un activo; sin fines de semana ni festivos), la misma base de 242 ruedas al año con que se anualizan los rendimientos: agregar días calendario con rendimiento cero obligaría a anualizar con 365 y rompería esa base. Si un activo no se negoció en una rueda, lleva su último precio cotizado hasta la siguiente operación (matriz cuadrada); antes de su primera cotización la celda queda vacía (un activo que empezó a cotizar hace poco se trabaja desde su primera cotización). Los precios cotizados no cambian, y el CSV de cada activo trae solo los días en que se negoció.
- **Solo la BVC**: los precios de acciones, índices y ETF salen únicamente de la BVC; la fuente automática queda solo para el dólar y el euro.
- **Todas las matrices de cálculo** (Descargas): además de precios, rendimientos, estadísticas, desviaciones, covarianza, correlación, portafolios, frontera y plan (con fórmulas de Excel), las del paso a paso: desviaciones respecto a la media, covarianzas ponderadas wᵢwⱼσᵢⱼ, puntos de la frontera, CML, SML, elección de activos del tangente, correlación promedio y contribución al riesgo, en CSV y como hojas del libro.
- **CSV para Excel en español**: los archivos que descarga la app (historial de cada activo, macro, matrices) usan punto y coma, punto de miles y coma decimal (2.400,5), y se vuelven a leer sin cambios.
- Limpieza única de COLTES y renta fija guardados con las reglas de lectura anteriores; sin textos genéricos bajo las gráficas y tablas.

0. Las advertencias sobre los datos ya no salen como alarma en los portafolios ni en los activos: quedan como nota en Datos. **Datos** es la primera sección; luego la **Terminal** (pantalla inicial, aspecto de bróker): cinta de cotizaciones, lista de seguimiento con minigráficas y, para cada acción, precio con rangos 1M a Todo, rendimientos diarios con bandas de ±2σ, distribución frente a la normal, rendimiento acumulado frente al índice, correlación móvil, desempeño por periodo y mapa de correlaciones. **Apariencia**: modo oscuro (predeterminado), claro o según el sistema, y color de fondo elegible para cada modo. Letra Times New Roman.
1. **Biblioteca local** (pestaña Biblioteca): guarda en el equipo (IndexedDB) el histórico de cada acción, ETF, índice e instrumento y de cada variable macro, y todos los cálculos se hacen con esos valores guardados.
   - **Fiel a la fuente:** se guarda exactamente lo que trae cada archivo (cierre, cantidad y volumen de cada día negociado, o la tasa en renta fija).
   - **Un solo activo por nemotécnico:** los tramos de 6 meses que descarga la BVC (por ejemplo `CIBEST_20260908_051610.csv`, `…_051637.csv`, `…_051648.csv`, o con el número de descarga delante, como `1790829234836-COLTES LP.csv`) se unen en un solo historial. Los tramos que versiones anteriores guardaron por separado se unen solos al abrir la app.
   - **Valores fijos:** un dato guardado no cambia; los archivos nuevos solo agregan fechas.
   - **Huecos:** los días sin negociación no se escriben; al calcular se completan con el último precio anterior.
   - **Fecha de corte** para repetir un análisis.
   - **Archivos:** un CSV por activo, respaldo para exportar e importar entre equipos y descarga de todos los históricos.
1. **Datos**: sube los históricos que descargas de la **Bolsa de Valores de Colombia** (Excel o CSV con nemotécnico, fecha, cantidad, volumen y precio de cierre): la BVC es la única fuente de precios de acciones, índices y ETF. Puedes subir varios archivos a la vez. La app une los tramos de 6 meses de una misma acción, toma el último cierre de cada periodo y conserva solo las fechas comunes a todos los activos. También acepta una tabla ya armada (una columna por activo más un índice) con coma, punto y coma o tabulador, y coma decimal. Incluye un ejemplo simulado de 60 meses.
   - **Fechas que no coinciden**: cada activo conserva sus propias fechas. Por defecto la media y la varianza de cada activo usan toda su historia, y cada correlación usa las fechas que comparten los dos activos; la matriz resultante se corrige para que sea válida. También puede usar solo los periodos comunes a todos.
   - **Precio de cada periodo**: último cierre (por defecto) o promedio del periodo, que amortigua columnas desfasadas como las de una hoja armada a mano. La app detecta series corridas en el tiempo respecto a las demás y lo avisa.
   - Rendimientos logarítmicos (por defecto, como en la hoja guía del curso) o simples; la frecuencia diaria anualiza con 242 días hábiles.
   - Días sin negociación de cualquier activo: se repite el último precio hasta el siguiente día hábil, desde la primera fecha de cada activo hasta hoy (antes de que empiece a cotizar queda vacío). El precio de referencia que publica la BVC sin cantidad negociada no se toma como cierre, y los festivos se quitan.
   - También lee libros de Excel con una tabla ancha (FECHA más una columna por activo, encabezados en dos filas, columna ITEM); si el libro trae hojas de precios y de rendimientos, usa las de precios.
   - **Otros instrumentos**: TES, bonos y CDT por precio o por tasa (TIR, tasa de negociación o de valoración; con la tasa arma un índice de rendimiento total: causación menos duración × cambio de tasa), divisas (columnas «TRM» o «Tasa de cambio») y futuros u opciones (precio de cierre o de liquidación). Detecta el tipo de cada instrumento y se puede corregir.
   - **Segmentos e índices**: casillas para invertir en renta variable, renta fija, derivados y divisas. Cada segmento usa su índice de referencia para β, CAPM, Treynor y Jensen: MSCI COLCAP (acciones y ETF), COLTES (TES y bonos), COLIBR (CDT y mercado monetario), TRM (divisas) y el del subyacente (derivados). Una tabla dice qué índice descargar y cuál falta. Con el COLIBR cargado, propone su rendimiento como tasa libre de riesgo.
2. **Activos**: rendimiento esperado, σ, β, α de Jensen con su t y valor p, razón de Sharpe, razón de Treynor y R². Incluye la línea del mercado de valores y la matriz de correlaciones.
3. **Portafolio**: frontera eficiente, línea del mercado de capitales y cinco portafolios: el **recomendado** (el mayor rendimiento sobre la frontera eficiente con un número efectivo de activos mínimo, sin un tope fijo por acción), el tangente (máxima razón de Sharpe), mínima varianza, máxima diversificación, paridad de riesgo y 1/N. Para cada uno muestra el rendimiento esperado con su IC 95 %, la σ, las razones de Sharpe y Treynor, el α de Jensen, la β, el M², el número efectivo de activos, la razón de diversificación, el VaR y los montos a invertir. También calcula el modelo de Treynor-Black.
4. **Confirmar**: escribes tus pesos, o las acciones que compraste de cada activo y la fecha de compra, y la app dice si el portafolio es eficiente. Con acciones y fecha, busca el cierre de ese día en los datos cargados (si no hubo negociación, el último cierre anterior), calcula lo invertido, los pesos reales, el valor al último cierre y la ganancia. Lo compara con el portafolio eficiente de igual riesgo y con el de igual rendimiento, y revisa una lista de criterios: Markowitz, Sharpe, Treynor, Jensen y diversificación.
5. **Comprar**: plan de inversión para tu presupuesto y horizonte (corto, mediano o largo plazo): acciones enteras para acciones y ETF, montos para renta fija, divisas y derivados. Comisión de compra y de venta por separado (trii ≈ $15.000), con botones para promociones a mitad de precio o sin comisión; monto mínimo por inversión (automático según las comisiones); parte en renta fija segura según la probabilidad de pérdida que aceptes (Tobin y Roy); proyección a 1, 3, 5 y 10 años neta de comisiones con rango del 95 % y probabilidad de pérdida. Con presupuestos pequeños prueba menos activos cuando el ahorro en comisiones lo justifica. El plan se puede registrar en Confirmar, donde cada compra lleva su propia comisión.
6. **Dónde invertir**: canales para cada parte del plan (trii, sociedades comisionistas, bancos y CDT, fondos de inversión colectiva, mercado de derivados de la BVC, divisas), costos, paso a paso y cómo verificar a la entidad en la Superintendencia Financiera y el AMV.
7. **Paso a paso**: con los datos cargados, el cálculo de la media, la varianza, la desviación estándar, la covarianza y la correlación. Muestra una tabla con las desviaciones, los cuadrados y los productos cruzados, cada fórmula con sus valores sustituidos y lo que significa cada término según su autor (Markowitz, Pearson, Sharpe, Treynor, Jensen). Incluye las matrices de todos los activos, la varianza del portafolio celda por celda (wᵢ wⱼ σᵢⱼ) y el efecto de la diversificación. Compara la **beta de Sharpe** (regresión, con su intervalo del 95 %) con la **beta de Damodaran** (de abajo hacia arriba: βL = βU [1 + (1 − t) D/E]), la beta ajustada de Blume y el costo del patrimonio con cada una. Lee el archivo de betas por industria de Damodaran.
8. **Macro**: PIB, inflación, desempleo y TRM de Colombia, con gráficos, y su relación con el índice y con cada activo: correlación, sensibilidad, t, R², adelanto del mercado y la interpretación según la teoría (Chen, Roll y Ross; Fama; Fama y Schwert; Boyd, Hu y Jagannathan; Dornbusch y Fischer). En la web se importan los archivos; la app de escritorio los descarga.
9. **Sistema financiero**:
   - la relación entre el sistema económico (agentes, flujo circular, ahorro = inversión) y el sistema financiero colombiano, con el esquema mercado monetario / de capitales (bancario y de valores: bursátil y extrabursátil) / de divisas / otros y sus instituciones;
   - las autoridades (Banco de la República, Ministerio de Hacienda, Superintendencia Financiera, AMV, Fogafín, BVC, Deceval, CRCC) y los canales entre la economía y el portafolio, con las cifras de la sección Macro;
   - la construcción de un índice (selección y ponderación), los índices de la BVC (COLEQTY, COLCAP, COLSC, COLIR, COLTES, COLTES UVR, COLIBR) y la función de selección del COLEQTY (volumen, rotación y frecuencia), calculada con la cantidad y el volumen de los CSV de la BVC;
   - un constructor de índice propio (por liquidez, capitalización, precios o pesos iguales) y las referencias bibliográficas.
10. **Descargas**: libro de Excel con todos los cálculos hechos con fórmulas (Precios, Rendimientos, Estadisticas, Desviaciones, Covarianza, Correlacion, Portafolios, Frontera, Plan_compra y una guía de fórmulas) y matrices sueltas en CSV. Las fórmulas del libro se verificaron recalculándolo con LibreOffice: dan los mismos resultados que la app.
11. **Teoría**: fórmulas y referencias.

## Supuestos configurables

- Tasa libre de riesgo y rendimiento esperado del mercado.
- Rendimientos esperados: históricos, del CAPM o una mezcla 50/50 (la opción predeterminada, que reduce el error de estimación).
- Covarianzas: muestrales (Markowitz) o del modelo de índice único (Sharpe).
- Peso mínimo y máximo por activo (100 % = sin tope; el recomendado usa el tope más holgado con el que alcanza la diversificación pedida). Un mínimo negativo permite ventas en corto.
- Diversificación del recomendado: N efectivo de al menos 80, 60 o 40 % de los activos.

## Método

`min ½ w'Σw − t·μ'w` sujeto a `Σw = 1` y `lo ≤ w ≤ hi` se resuelve exactamente por conjunto activo (`js/optim.js`). Al variar t se recorre la frontera. El portafolio tangente y el de máxima diversificación se obtienen maximizando una razón a lo largo de su frontera. Las pruebas comparan los resultados con las fórmulas cerradas sin restricciones, con un gradiente proyectado y con 5000 portafolios aleatorios.

```
js/stats.js    estadística, regresión, lectura de CSV
js/optim.js    programa cuadrático, frontera, tangente, paridad de riesgo
js/model.js    modelo de mercado, medidas, confirmación, Treynor-Black
js/sample.js   datos de ejemplo simulados
js/plan.js     plan de inversión: montos mínimos, comisiones, horizonte y renta fija
js/xlsx.js     escritor de libros de Excel sin dependencias
js/report.js   libro de cálculos con fórmulas
js/invertir.js canales y paso a paso para invertir
js/pasos.js    varianza, covarianza y correlación paso a paso; beta de Sharpe frente a Damodaran
js/macro.js    variables macroeconómicas: lectores, relación con el mercado y gráficos
js/sistema.js  sistema económico y sistema financiero de Colombia
js/indices.js  construcción de índices, índices de la BVC, liquidez del COLEQTY y referencias
js/charts.js   gráficos SVG
js/app.js      interfaz
tests/run.js   pruebas del motor (node portafolios/tests/run.js)
tests/e2e.js   prueba en navegador con Playwright (la parte de Excel requiere el paquete xlsx)
```

Es una herramienta educativa: los rendimientos pasados no garantizan los futuros y no constituye asesoría de inversión.
