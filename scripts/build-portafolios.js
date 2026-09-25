/* Genera una versión de un solo archivo HTML (CSS y JS en línea), útil para
 * compartir la app de portafolios como página independiente.
 * Uso: node scripts/build-portafolios.js [salida.html] */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'portafolios');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const body = html.split('<!--APP-START-->')[1].split('<!--APP-END-->')[0];
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) =>
  fs.readFileSync(path.join(root, m[1]), 'utf8').replace(/<\/script/gi, '<\\/script')
);
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
const out = `${title}
${fonts}
<style>
${css}
</style>
${body}
<script>
${scripts.join('\n')}
</script>
`;
const dest = process.argv[2] || path.join(root, '..', 'dist', 'frontera-eficiente.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('Escrito', dest, (out.length / 1024).toFixed(0) + ' KB');
