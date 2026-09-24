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
