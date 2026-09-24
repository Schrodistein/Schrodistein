/* Bancos de ítems fijos: comprensión verbal (Gc) y razonamiento lógico-cuantitativo.
 * Cada ítem lleva parámetros TRI a priori (b = dificultad en logits).
 * Los valores de b son estimaciones de los autores basadas en la frecuencia léxica
 * de las palabras (para vocabulario) y en la complejidad del razonamiento; no
 * proceden de una calibración con muestra normativa (ver "Limitaciones").
 * Formato: la primera opción listada es la correcta; se barajan al mostrar. */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});

  const VERBAL = [
    // Analogías
    { id: 'an1', b: -2.6, sub: 'Analogía', q: 'Perro es a ladrar como gato es a…', o: ['maullar', 'correr', 'dormir', 'cazar'] },
    { id: 'an2', b: -2.2, sub: 'Analogía', q: 'Cabeza es a sombrero como pie es a…', o: ['zapato', 'pierna', 'dedo', 'caminar'] },
    { id: 'an3', b: -1.9, sub: 'Analogía', q: 'Libro es a leer como cuchillo es a…', o: ['cortar', 'cocina', 'afilado', 'mango'] },
    { id: 'an4', b: -1.4, sub: 'Analogía', q: 'Pez es a aleta como pájaro es a…', o: ['ala', 'pico', 'nido', 'cielo'] },
    { id: 'an5', b: -1.0, sub: 'Analogía', q: 'Semilla es a árbol como huevo es a…', o: ['ave', 'nido', 'cáscara', 'yema'] },
    { id: 'an6', b: -0.7, sub: 'Analogía', q: 'Reloj es a tiempo como termómetro es a…', o: ['temperatura', 'fiebre', 'mercurio', 'invierno'] },
    { id: 'an7', b: -0.3, sub: 'Analogía', q: 'Capítulo es a libro como escena es a…', o: ['obra de teatro', 'actor', 'telón', 'guion'] },
    { id: 'an8', b: 0.1, sub: 'Analogía', q: 'Arquitecto es a edificio como compositor es a…', o: ['sinfonía', 'piano', 'orquesta', 'partitura en blanco'] },
    { id: 'an9', b: 0.4, sub: 'Analogía', q: 'Sequía es a agua como hambruna es a…', o: ['alimento', 'pobreza', 'sed', 'cosecha'] },
    { id: 'an10', b: 0.8, sub: 'Analogía', q: 'Mitigar es a agravar como elogiar es a…', o: ['censurar', 'alabar', 'premiar', 'olvidar'] },
    { id: 'an11', b: 0.9, sub: 'Analogía', q: 'Ornitología es a aves como entomología es a…', o: ['insectos', 'palabras', 'raíces', 'hongos'] },
    { id: 'an12', b: 1.2, sub: 'Analogía', q: 'Sístole es a diástole como inspiración es a…', o: ['espiración', 'respiración', 'pulmón', 'aliento'] },
    { id: 'an13', b: 1.4, sub: 'Analogía', q: 'Efímero es a perdurable como exiguo es a…', o: ['abundante', 'escaso', 'breve', 'pequeño'] },
    { id: 'an14', b: 1.7, sub: 'Analogía', q: 'Hipérbole es a exageración como eufemismo es a…', o: ['atenuación', 'repetición', 'comparación', 'contradicción'] },
    // Vocabulario (sinónimos)
    { id: 'vo1', b: -2.5, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que VELOZ?', o: ['rápido', 'lento', 'fuerte', 'alto'] },
    { id: 'vo2', b: -2.0, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que ENORME?', o: ['gigantesco', 'pesado', 'redondo', 'lejano'] },
    { id: 'vo3', b: -0.3, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que EFÍMERO?', o: ['pasajero', 'eterno', 'famoso', 'eficaz'] },
    { id: 'vo4', b: 0.3, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que PERSPICAZ?', o: ['sagaz', 'torpe', 'perezoso', 'confiado'] },
    { id: 'vo5', b: 0.5, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que DÁDIVA?', o: ['regalo', 'deuda', 'duda', 'castigo'] },
    { id: 'vo6', b: 0.7, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que INOCUO?', o: ['inofensivo', 'inútil', 'peligroso', 'ingenuo'] },
    { id: 'vo7', b: 0.8, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que DIÁFANO?', o: ['claro', 'oscuro', 'difícil', 'torpe'] },
    { id: 'vo8', b: 0.9, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que ABNEGACIÓN?', o: ['sacrificio', 'negación', 'rechazo', 'abundancia'] },
    { id: 'vo9', b: 1.1, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que INEFABLE?', o: ['indescriptible', 'inevitable', 'ineficaz', 'infalible'] },
    { id: 'vo10', b: 1.2, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que PUSILÁNIME?', o: ['cobarde', 'valiente', 'generoso', 'diminuto'] },
    { id: 'vo11', b: 1.4, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que SOSLAYAR?', o: ['eludir', 'enfrentar', 'suavizar', 'contemplar'] },
    { id: 'vo12', b: 1.6, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que ACÉRRIMO?', o: ['tenaz', 'ácido', 'tibio', 'afilado'] },
    { id: 'vo13', b: 1.9, sub: 'Vocabulario', q: '¿Qué palabra significa lo mismo que CONSPICUO?', o: ['sobresaliente', 'conspirador', 'discreto', 'sospechoso'] },
    { id: 'vo14', b: 2.2, sub: 'Vocabulario', q: '¿Qué significa UBÉRRIMO?', o: ['muy fértil', 'muy alto', 'muy seco', 'muy antiguo'] },
    // Categorización (la que no pertenece)
    { id: 'ca1', b: -2.1, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['zanahoria', 'manzana', 'pera', 'uva'] },
    { id: 'ca2', b: -1.2, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['cubo', 'triángulo', 'cuadrado', 'pentágono'] },
    { id: 'ca3', b: -1.1, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['trompeta', 'violín', 'guitarra', 'arpa'] },
    { id: 'ca4', b: -0.8, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['Luna', 'Mercurio', 'Venus', 'Marte'] },
    { id: 'ca5', b: -0.2, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['tiburón', 'ballena', 'delfín', 'foca'] },
    { id: 'ca6', b: 0.4, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['roble', 'pino', 'abeto', 'ciprés'] },
    { id: 'ca7', b: 0.6, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['novela', 'soneto', 'oda', 'elegía'] },
    { id: 'ca8', b: 1.1, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['bronce', 'cobre', 'hierro', 'oro'] },
    { id: 'ca9', b: 1.7, sub: 'Categorías', q: '¿Qué palabra NO pertenece al grupo?', o: ['rubí', 'ámbar', 'perla', 'coral'] },
  ];

  const VERBAL_WHY = {
    ca2: 'El cubo es un cuerpo tridimensional; los demás son figuras planas.',
    ca3: 'La trompeta es de viento; los demás son instrumentos de cuerda.',
    ca4: 'La Luna es un satélite; los demás son planetas.',
    ca5: 'El tiburón es un pez; los demás son mamíferos.',
    ca6: 'El roble es de hoja caduca; los demás son coníferas.',
    ca7: 'La novela es prosa; los demás son formas poéticas.',
    ca8: 'El bronce es una aleación; los demás son elementos químicos.',
    ca9: 'El rubí es un mineral; ámbar, perla y coral son de origen orgánico.',
    an12: 'Sístole y diástole son fases opuestas del latido, como inspiración y espiración en la respiración.',
    an14: 'La hipérbole exagera; el eufemismo atenúa o suaviza.',
  };

  /* Razonamiento lógico-cuantitativo (acertijos).
   * t: 'mc' (opción múltiple, la primera es la correcta) o 'num' (respuesta numérica). */
  const LOGIC = [
    { id: 'lo1', b: -2.2, t: 'num', q: 'Si 3 lápices cuestan 6 €, ¿cuántos euros cuestan 7 lápices?', ans: 14, why: 'Cada lápiz cuesta 2 €; 7 × 2 = 14.' },
    { id: 'lo2', b: -1.3, t: 'mc', q: 'Ana es mayor que Beto. Carla es menor que Beto. Dani es mayor que Ana. ¿Quién es el menor?', o: ['Carla', 'Beto', 'Ana', 'Dani'], why: 'Orden: Dani > Ana > Beto > Carla.' },
    { id: 'lo3', b: -1.0, t: 'mc', q: 'Todos los blips son flops y todos los flops son trunks. ¿Son todos los blips trunks?', o: ['Sí, necesariamente', 'No, nunca', 'No se puede saber'], why: 'La inclusión es transitiva: blips ⊂ flops ⊂ trunks.' },
    { id: 'lo4', b: -0.6, t: 'num', q: 'La suma de las edades de una madre y su hijo es 36. La madre tiene 5 veces la edad del hijo. ¿Cuántos años tiene el hijo?', ans: 6, why: 'h + 5h = 36 → 6h = 36 → h = 6.' },
    { id: 'lo5', b: -0.4, t: 'num', q: 'Un tren recorre 120 km en 1 hora y media. ¿Cuál es su velocidad media en km/h?', ans: 80, why: '120 / 1,5 = 80 km/h.' },
    { id: 'lo6', b: 0.1, t: 'mc', q: 'Si hoy es miércoles, ¿qué día de la semana será dentro de 100 días?', o: ['Viernes', 'Jueves', 'Sábado', 'Miércoles'], why: '100 = 14 × 7 + 2; dos días después del miércoles es viernes.' },
    { id: 'lo7', b: 0.3, t: 'num', q: 'Unos nenúfares duplican su superficie cada día y tardan 48 días en cubrir todo el lago. ¿Cuántos días tardan en cubrir la mitad?', ans: 47, why: 'Si se duplican cada día, el día anterior a cubrirlo todo cubrían la mitad: 47.' },
    { id: 'lo8', b: 0.4, t: 'mc', q: 'Algunos médicos son músicos. Algunos músicos son pintores. ¿Se deduce que algunos médicos son pintores?', o: ['No se deduce', 'Sí, necesariamente', 'No, ninguno lo es'], why: 'Los músicos que son médicos pueden no ser los mismos que los músicos que pintan.' },
    { id: 'lo9', b: 0.5, t: 'num', q: 'Un bate y una pelota cuestan 1,10 € en total. El bate cuesta 1 € más que la pelota. ¿Cuántos céntimos cuesta la pelota?', ans: 5, why: 'p + (p + 1) = 1,10 → 2p = 0,10 → p = 0,05 € (5 céntimos). La respuesta intuitiva, 10, es incorrecta.' },
    { id: 'lo10', b: 0.6, t: 'num', q: 'En una reunión de 10 personas, cada una da la mano exactamente una vez a cada una de las demás. ¿Cuántos apretones de manos hay?', ans: 45, why: '10 × 9 / 2 = 45.' },
    { id: 'lo11', b: 0.6, t: 'num', q: 'Si 5 máquinas fabrican 5 piezas en 5 minutos, ¿cuántos minutos tardarán 100 máquinas en fabricar 100 piezas?', ans: 5, why: 'Cada máquina hace una pieza en 5 minutos, así que 100 máquinas hacen 100 piezas en 5 minutos.' },
    { id: 'lo12', b: 0.7, t: 'mc', q: 'Si el día anterior a pasado mañana es sábado, ¿qué día es hoy?', o: ['Viernes', 'Jueves', 'Sábado', 'Domingo'], why: 'El día anterior a pasado mañana es mañana. Si mañana es sábado, hoy es viernes.' },
    { id: 'lo13', b: 0.8, t: 'num', q: 'Si 2 gatos cazan 2 ratones en 2 minutos, ¿cuántos gatos hacen falta para cazar 6 ratones en 6 minutos?', ans: 2, why: 'Cada gato caza 1 ratón cada 2 minutos: en 6 minutos, 2 gatos cazan 6 ratones.' },
    { id: 'lo14', b: 0.9, t: 'num', q: 'Un caracol está en el fondo de un pozo de 10 m. Cada día sube 3 m y cada noche resbala 2 m. ¿Qué día sale del pozo?', ans: 8, why: 'Tras 7 días y noches está a 7 m; el día 8 sube 3 m y llega a 10 m.' },
    { id: 'lo15', b: 1.0, t: 'mc', q: 'Ningún reptil tiene pelo. Algunas mascotas son reptiles. ¿Qué se deduce con certeza?', o: ['Algunas mascotas no tienen pelo', 'Ninguna mascota tiene pelo', 'Algunos reptiles no son mascotas', 'Nada se deduce'], why: 'Las mascotas que son reptiles no tienen pelo.' },
    { id: 'lo16', b: 1.5, t: 'num', q: 'Un reloj marca exactamente las 3:15. ¿Cuántos grados forman las agujas? (puedes usar decimales)', ans: 7.5, why: 'El minutero está a 90°. La aguja horaria avanza 0,5° por minuto: 90 + 7,5 = 97,5°. Diferencia: 7,5°.' },
    { id: 'lo17', b: 1.6, t: 'mc', q: 'Cuatro cartas tienen una letra en una cara y un número en la otra. Ves: A, K, 4, 7. Regla: «si una carta tiene vocal, en su reverso hay un número par». ¿Qué cartas debes girar, como mínimo, para comprobar la regla?', o: ['A y 7', 'A y 4', 'Solo la A', 'A, 4 y 7'], why: 'La A (si detrás hay impar, la regla falla) y el 7 (si detrás hay vocal, falla). El 4 no puede refutar la regla (tarea de Wason, 1968).' },
    { id: 'lo18', b: 1.9, t: 'num', q: 'Un chico tiene tantos hermanos como hermanas. Cada una de sus hermanas tiene el doble de hermanos que de hermanas. ¿Cuántos hijos hay en la familia?', ans: 7, why: '4 chicos y 3 chicas. Cada chico: 3 hermanos y 3 hermanas. Cada chica: 4 hermanos y 2 hermanas.' },
    { id: 'lo19', b: 2.1, t: 'num', q: 'Tres grifos llenan un depósito: el primero solo en 6 h, el segundo en 3 h y el tercero en 2 h. Abiertos a la vez, ¿cuántas horas tardan?', ans: 1, why: '1/6 + 1/3 + 1/2 = 1 depósito por hora.' },
  ];

  IQ.banks = { VERBAL, VERBAL_WHY, LOGIC };
})(typeof globalThis !== 'undefined' ? globalThis : this);
