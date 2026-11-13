// Servidor de la aplicación: en el PC atiende solo a este equipo; en la página web (Render) atiende a todos,
// pero sin llamadas, sin voz Kusuri y sin guardar personajes
const http = require('http'), fs = require('fs'), path = require('path');
const llamadas = require('./llamadas');
const personajes = require('./personajes');
const PUERTO = process.env.PORT || 8105, RAIZ = path.join(__dirname, '..', 'pagina');
const WEB = !!process.env.RENDER || process.env.MODO_WEB === '1';
const tipos = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.vrm': 'application/octet-stream', '.vrma': 'application/octet-stream', '.task': 'application/octet-stream', '.onnx': 'application/octet-stream',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.ico': 'image/x-icon'
};

// El personaje que viene con la aplicación
function personajeOriginal() {
  // en la página web solo va la muestra de three-vrm (su licencia permite compartirla)
  const lista = WEB ? [path.join(RAIZ, 'prueba.vrm')] : [path.join(RAIZ, 'personaje-propio.vrm'), path.join(RAIZ, '..', '..', 'filo.vrm'), path.join(RAIZ, 'prueba.vrm')];
  for (const p of lista) {
    if (fs.existsSync(p)) return p;
  }
}

const servidor = http.createServer((pide, responde) => {
  if (pide.url === '/modo') { responde.writeHead(200, { 'Content-Type': 'application/json' }); return responde.end(JSON.stringify({ web: WEB })); }
  if (pide.url.startsWith('/llamadas/') || pide.url.startsWith('/voz/')) { if (WEB) { responde.writeHead(404); return responde.end(); } return llamadas.atender(pide, responde); }
  if (pide.url.startsWith('/personajes/')) return personajes.atender(pide, responde);
  let ruta;
  try { ruta = decodeURIComponent(pide.url.split('?')[0]); } catch (e) { responde.writeHead(400); return responde.end(); }
  if (ruta === '/') ruta = '/index.html';
  const archivo = ruta === '/personaje.vrm' ? personajeOriginal() : path.resolve(RAIZ, '.' + path.normalize(ruta));
  const dentro = archivo && (ruta === '/personaje.vrm' || archivo.startsWith(RAIZ + path.sep));
  if (!dentro || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    responde.writeHead(404); return responde.end('No existe');
  }
  responde.writeHead(200, { 'Content-Type': tipos[path.extname(archivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(archivo).pipe(responde);
});

function iniciar() {
  return new Promise((listo, fallo) => {
    servidor.once('error', fallo);
    servidor.listen(PUERTO, WEB ? '0.0.0.0' : '127.0.0.1', () => { console.log('Abre http://localhost:' + PUERTO); listo(); });
  });
}

if (require.main === module) iniciar();
module.exports = { iniciar, PUERTO, apagarLlamada: llamadas.apagar };
