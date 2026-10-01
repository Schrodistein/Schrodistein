# Escala Schrodistein

Aplicación web instalable (PWA) que estima el cociente intelectual (CI) con una batería cognitiva adaptativa. Funciona en móvil, tableta y ordenador, también sin conexión, y no tiene dependencias.

## Uso

```bash
npm start          # sirve la app en http://localhost:8080
npm test           # pruebas unitarias y de simulación (Node, sin dependencias)
npm run e2e        # prueba de extremo a extremo con Playwright (requiere el servidor)
npm run build:single   # genera dist/escala-schrodistein.html (un solo archivo)
```

Para instalarla en el móvil, publica la carpeta en cualquier hosting estático con HTTPS (GitHub Pages, Netlify…), ábrela en el navegador y elige «Añadir a pantalla de inicio».

## Qué mide

Cinco índices del modelo CHC, los mismos que informan las escalas Wechsler actuales:

| Índice | Capacidad CHC | Subpruebas |
|---|---|---|
| ICV Comprensión verbal | Gc | Analogías, vocabulario, categorías |
| IRF Razonamiento fluido | Gf | Matrices generadas, series numéricas, acertijos lógicos |
| IVE Visoespacial | Gv | Rotación mental |
| IMT Memoria de trabajo | Gwm | Dígitos directos e inversos, bloques de Corsi |
| IVP Velocidad de procesamiento | Gs | Búsqueda de símbolos |

Hay dos versiones: completa (9 subpruebas, 35–45 min) y breve (8 subpruebas, 20–25 min). La sección **Entrenar** permite practicar cada tarea con corrección y explicación, e incluye una Torre de Hanói.

## Método

- **Teoría de respuesta al ítem (3PL)** y estimación **EAP** del nivel θ con previa N(0, 1) (`js/irt.js`).
- **Test adaptativo**: cada ítem se elige por máxima información de Fisher en el θ provisional.
- **Generación automática de ítems** con dificultad predicha por sus reglas: matrices según Carpenter et al. (1990) y Embretson (1998), con distractores I-RAVEN (Hu et al., 2021); series numéricas; rotación mental con poliominós quirales.
- **Baremo por edad** según las tendencias de Salthouse (2009).
- **CI total** = media re-estandarizada de los cinco índices (correlación media entre índices ≈ 0,5), con intervalo de confianza al 95 %.
- **Indicadores de validez**: respuestas demasiado rápidas, tiempos agotados, salidas de la app y exceso de errores en la tarea de velocidad.
- **Rangos**: categorías descriptivas de la WAIS-IV (130+ Muy superior … ≤69 Extremadamente bajo).

## Limitaciones

Los parámetros de los ítems y las normas de memoria y velocidad son estimaciones a priori tomadas de la literatura, no de una muestra normativa propia. Por eso el error típico incluye 0,2 DT de incertidumbre de calibración. El resultado es orientativo: un CI con validez diagnóstica solo lo da un profesional con una prueba estandarizada (WAIS-IV/5, WISC-V, etc.).

Para calibrar la escala de verdad habría que recoger respuestas de una muestra amplia y representativa, estimar los parámetros a, b y c por máxima verosimilitud marginal y construir baremos por edad.

## Estructura

```
index.html            interfaz (pantallas de inicio, prueba, resultados, rangos, ciencia, historial)
css/styles.css        estilos (tema claro y oscuro)
js/core.js            PRNG reproducible y utilidades
js/irt.js             modelo 3PL, EAP, información, percentiles y rangos
js/gen-matrices.js    generador de matrices progresivas (SVG)
js/gen-series.js      generador de series numéricas
js/gen-rotation.js    generador de rotación mental (SVG)
js/banks.js           ítems verbales y acertijos lógicos
js/battery.js         subpruebas, selección adaptativa, baremos y puntuación
js/charts.js          curva normal y perfil de índices
js/app.js             controlador de la interfaz
sw.js                 service worker (uso sin conexión)
tests/run.js          pruebas
```

---

# Radar de Divisas (`trading/`)

Aplicación web instalable (PWA) que analiza divisas y los mercados de Binance, reconoce patrones, proyecta el comportamiento del precio y avisa de entradas de compra y venta. Sin dependencias y **sin enviar órdenes** (tú decides y ejecutas).

| Fuente | Qué aporta | Clave |
|---|---|---|
| Binance | Criptos y pares tipo divisa (EURUSDT, USDTTRY, PAXGUSDT…) en directo; sentimiento de futuros | No |
| Twelve Data | Velas intradía de cualquier par de divisas y del oro/plata (EUR/USD, USD/JPY, XAU/USD…) | Gratuita (800 consultas/día) |
| BCE (Frankfurter) | Tipos de referencia diarios de ~30 divisas desde 1999; fuerza relativa y correlaciones | No |
| Forex Factory | Calendario económico semanal; aviso de datos de alto impacto en las próximas 24 h | No |

La pestaña **Divisas** reúne las sesiones (Sídney, Tokio, Londres, Nueva York con horario de verano), el calendario, la fuerza de las 8 divisas principales y la matriz de correlaciones. La calculadora de riesgo da el tamaño en **lotes**, el stop en **pips** y el valor del pip en la divisa de la cuenta.

```bash
npm start              # abre http://localhost:8080/trading/
npm test               # pruebas de las dos apps (Node, sin dependencias)
npm run e2e:trading    # extremo a extremo con Binance simulado (Playwright)
npm run scan -- --symbols EUR/USD,USD/JPY,BTCUSDT --interval 1h   # escáner de consola
npm run scan -- --calendar --currencies USD,EUR                    # calendario económico
npm run scan -- --strength                                         # fuerza de las divisas
npm run scan -- --watch                                            # avisos 24/7 (Telegram opcional)
npm run scan -- --symbols EURUSDT --interval 4h --backtest --bars 5000
```

## Aplicación de escritorio (`desktop/`)

Versión para Windows, macOS y Linux hecha con Electron. Es la misma app, con ventajas de escritorio:

- **Sigue en la bandeja del sistema** al cerrar la ventana: el escáner y los avisos continúan mientras el ordenador esté encendido (opción «Iniciar con el sistema» en Windows y macOS).
- Notificaciones del sistema que, al pulsarlas, abren la ventana; parpadeo en la barra de tareas con cada aviso.
- El calendario económico funciona aunque el proveedor no admita peticiones desde el navegador.
- Seguridad: la página se sirve desde un protocolo propio con una política de contenidos estricta, sin acceso a Node; los enlaces se abren en el navegador.

**Descargar**: los instaladores se compilan en GitHub Actions (flujo «Aplicación de escritorio»), en la sección *Artifacts* de cada ejecución: `.exe` instalable y portable para Windows, `.dmg` para macOS (Intel y Apple Silicon) y `.AppImage` para Linux. Al publicar una etiqueta `v1.0.0` se crea una *Release* con los tres.

Los instaladores no están firmados: en Windows, SmartScreen avisará («Más información» → «Ejecutar de todas formas»); en macOS, abre la app con clic derecho → «Abrir» la primera vez; en Linux, `chmod +x` al `.AppImage`.

**Compilar o ejecutar en local**:

```bash
cd desktop && npm install
npm start              # ejecutar sin instalar
npm run dist           # instaladores para tu sistema en desktop/dist
```

Para velas intradía de divisas en el escáner de consola, define `TWELVEDATA_API_KEY`. Para recibir los avisos en Telegram, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.

## Qué analiza

Cada vela cerrada se evalúa con todas las escuelas y se combina en una puntuación de confluencia para compra y otra para venta. Cada escuela tiene un tope de puntos (los indicadores de una misma familia están correlacionados) y los factores en contra restan.

| Escuela | Herramientas |
|---|---|
| Tendencia | Teoría de Dow (máximos/mínimos), EMA 20/50/200, ADX ±DI, Ichimoku, Supertrend |
| Temporalidad superior | Tendencia del marco mayor reconstruida con las propias velas (1 h → 4 h, 4 h → 1 d…) |
| Momento | RSI, MACD, estocástico, CCI, divergencias normales y ocultas (RSI y MACD) |
| Volatilidad | Bollinger, squeeze Bollinger/Keltner, canal de Donchian |
| Volumen | OBV, MFI, Chaikin Money Flow, VWAP, picos de volumen |
| Velas japonesas | Martillo, estrella fugaz, envolventes, línea penetrante, nube oscura, harami, pinzas, estrellas de la mañana/atardecer, tres soldados/cuervos, doji |
| Estructura y chartismo | Soportes y resistencias por agrupación de pivotes, rupturas con volumen, doble suelo/techo, HCH e HCH invertido, triángulos, cuñas, canales, banderas, Fibonacci, puntos pivote, BOS/CHoCH, huecos de valor (FVG) |
| Estadística | Pendiente de regresión con t de Student, régimen de Hurst (modula el peso de los disparadores de tendencia y de reversión) |

Una señal exige un disparador en esa vela, superar el umbral del perfil (conservador, equilibrado o agresivo), ventaja sobre el lado contrario y, si el filtro está activo, no ir contra la tendencia. Incluye entrada, stop (ATR o extremo reciente), objetivo por R:R y tamaño de posición con comisiones.

## Proyección

- Volatilidad con **GARCH(1,1)** ajustado por máxima verosimilitud.
- **Simulación histórica filtrada** (2 000 trayectorias con los residuos reales del par) → cono de precios al 50 % y 90 % y probabilidad de tocar el objetivo antes que el stop (con corrección de puente browniano).
- **Régimen**: exponente de Hurst (R/S con la corrección de Anis-Lloyd-Peters) y ratio de varianzas de Lo-MacKinlay.
- **Tasas base empíricas**: qué hizo realmente el par tras situaciones con el mismo sesgo, con intervalo de Wilson y muestras sin solapamiento.
- Escenarios alcista, bajista y central, niveles clave y sentimiento de futuros (financiación, interés abierto, ratio largos/cortos).

## Validación

- **Backtest** con el mismo motor que en vivo: señal al cierre, entrada en la apertura siguiente, comisiones, deslizamiento, salida por tiempo y stop primero si una vela toca stop y objetivo. Muestra el intervalo de confianza de la esperanza y lo compara con comprar y mantener.
- Las pruebas comprueban que **ningún cálculo mira al futuro** (la señal en la vela *i* es idéntica con o sin las velas posteriores).

## Limitaciones

Ningún análisis garantiza ganancias. No incluye análisis fundamental ni noticias (consulta un calendario económico), ni ondas de Elliott o patrones armónicos (demasiado subjetivos para automatizarlos). Binance es un exchange de criptomonedas: sus pares tipo divisa son de monedas estables frente a monedas nacionales (EURUSDT, USDTTRY, USDTBRL…) y oro tokenizado (PAXGUSDT); en spot no se puede vender en corto. Los avisos de la app web llegan mientras está abierta; para 24/7 usa el escáner de consola.

## Estructura

```
trading/index.html          interfaz
trading/css/styles.css      estilos (tema claro y oscuro)
trading/js/core.js          utilidades, temporalidades y mercado sintético (pruebas y demo)
trading/js/indicators.js    indicadores técnicos causales
trading/js/patterns.js      velas, pivotes, niveles, figuras, Fibonacci, estructura, FVG, divergencias
trading/js/stats.js         Hurst, ratio de varianzas, GARCH, simulación y tasas base
trading/js/signals.js       motor de confluencia y temporalidad superior
trading/js/backtest.js      tamaño de posición y backtest
trading/js/binance.js       datos públicos de Binance (REST, WebSocket, futuros)
trading/js/forex.js         pares, pips y lotes, sesiones, fuerza relativa, correlaciones, calendario
trading/js/feeds.js         fuentes con interfaz común: Binance, Twelve Data, BCE y Forex Factory
trading/js/chart.js         gráfico de velas en canvas
trading/js/guide.js         contenido de la guía
trading/js/app.js           controlador de la interfaz
trading/sw.js               service worker (uso sin conexión y notificaciones)
desktop/main.js             aplicación de escritorio (Electron): ventana, bandeja, protocolo y seguridad
desktop/preload.js          puente mínimo entre la página y el escritorio
scripts/scan.js             escáner de consola con avisos por Telegram
tests/trading.js            pruebas
```
