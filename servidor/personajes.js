// Personajes guardados en este PC, para que la ventana principal y la llamada usen el mismo.
// En la página web (Render) no se guarda nada: cada visitante elige sin cambiarle nada a los demás.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { permitido, origenPropio, avisar } = require('./llamadas');

const DATOS = process.env.BAILE_DATOS || path.join(process.env.APPDATA || __dirname, 'BaileVRM');
const CARPETA = path.join(DATOS, 'personajes');
const LISTA = path.join(DATOS, 'lista.json');
const MAX_ARCHIVO = 500 * 1024 * 1024;
const ORIGINAL = 'original';
const WEB = !!process.env.RENDER || process.env.MODO_WEB === '1';
// Personajes que vienen con la aplicación (con licencia que permite compartirlos)
const INCLUIDOS = [
  { id: 'shibahu', nombre: 'Shibahu', archivo: path.join(__dirname, '..', 'pagina', 'personajes-incluidos', 'shibahu.vrm') },
  { id: 'zorra', nombre: 'Zorra', archivo: path.join(__dirname, '..', 'pagina', 'personajes-incluidos', 'zorra.vrm') }]
  .filter(p => fs.existsSync(p.archivo));

function leerGuardados() {
  if (!WEB) try {
    const d = JSON.parse(fs.readFileSync(LISTA, 'utf8'));
    if (Array.isArray(d.lista) && d.lista.some(p => p.id === ORIGINAL)) return d;
  } catch (e) {}
  return { actual: ORIGINAL, lista: [{ id: ORIGINAL, nombre: 'Personaje original', ajustes: null, foto: '' }] };
}
// se suman los incluidos que no estén ya (si ya subiste uno con el mismo nombre, queda el tuyo)
function leer() {
  const d = leerGuardados(), nombres = new Set(d.lista.map(p => p.nombre.toLowerCase()));
  for (const p of INCLUIDOS) if (!nombres.has(p.nombre.toLowerCase())) d.lista.push({ id: p.id, nombre: p.nombre, ajustes: null, foto: '', incluido: true });
  if (WEB && d.actual === ORIGINAL && INCLUIDOS.length) d.actual = INCLUIDOS[0].id;
  return d;
}
const sinIncluidos = d => ({ ...d, lista: d.lista.filter(p => !p.incluido) });
function guardar(d) {
  if (WEB) return;
  d = sinIncluidos(d);
  fs.mkdirSync(DATOS, { recursive: true });
  const temporal = LISTA + '.tmp';
  fs.writeFileSync(temporal, JSON.stringify(d));
  fs.renameSync(temporal, LISTA);
}
const archivoDe = id => path.join(CARPETA, id + '.vrm');
const nombreLimpio = t => (String(t || '').replace(/\.vrm$/i, '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60)) || 'Personaje sin nombre';

function leerJSON(pide, limite = 300000) {
  return new Promise(res => {
    let t = '', demasiado = false;
    pide.on('data', d => { t += d; if (t.length > limite) { demasiado = true; pide.destroy(); } });
    pide.on('end', () => { try { res(demasiado ? null : JSON.parse(t)); } catch (e) { res(null); } });
    pide.on('error', () => res(null));
  });
}

// El archivo se escribe primero aparte: si algo falla, no queda un personaje a medias
function recibirArchivo(pide, nombre, json) {
  fs.mkdirSync(CARPETA, { recursive: true });
  const id = crypto.randomUUID(), temporal = archivoDe(id) + '.tmp', salida = fs.createWriteStream(temporal);
  let total = 0, inicio = Buffer.alloc(0), malo = '';
  const limpiar = () => { salida.destroy(); fs.rm(temporal, { force: true }, () => {}); };
  pide.on('data', d => {
    total += d.length;
    if (inicio.length < 4) inicio = Buffer.concat([inicio, d]).subarray(0, 4);
    if (total > MAX_ARCHIVO && !malo) { malo = 'El archivo pesa más de 500 MB.'; pide.unpipe(salida); limpiar(); json(413, { error: malo }); }
  });
  pide.on('aborted', limpiar);
  salida.on('error', () => { if (!malo) { malo = 'No se pudo guardar el archivo.'; json(500, { error: malo }); } limpiar(); });
  salida.on('finish', () => {
    if (malo) return;
    if (inicio.toString('latin1') !== 'glTF') { limpiar(); return json(400, { error: 'Ese archivo no es un personaje .vrm.' }); }
    fs.renameSync(temporal, archivoDe(id));
    const d = leer();
    d.lista.push({ id, nombre: nombreLimpio(nombre), ajustes: null, foto: '' });
    guardar(d);
    json(200, { id, lista: d });
  });
  pide.pipe(salida);
}

async function atender(pide, responde) {
  const json = (codigo, datos) => { responde.writeHead(codigo, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); responde.end(JSON.stringify(datos)); };
  if (!WEB && !permitido(pide)) return json(403, { error: 'Solo funciona en este PC.' });
  const url = new URL(pide.url, 'http://localhost'), ruta = url.pathname;

  if (pide.method === 'GET') {
    if (ruta === '/personajes/lista') return json(200, leer());
    const inc = INCLUIDOS.find(p => ruta === '/personajes/archivo/' + p.id + '.vrm');
    if (inc) {
      responde.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(inc.archivo).pipe(responde);
    }
    const m = !WEB && ruta.match(/^\/personajes\/archivo\/([0-9a-f-]{36})\.vrm$/);
    if (m && fs.existsSync(archivoDe(m[1]))) {
      responde.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(archivoDe(m[1])).pipe(responde);
    }
    return json(404, { error: 'No existe.' });
  }
  if (pide.method !== 'POST' || (!WEB && !origenPropio(pide))) return json(403, { error: 'Solo desde esta página.' });
  if (WEB && (url.pathname === '/personajes/subir' || url.pathname === '/personajes/quitar')) return json(403, { error: 'En la página web no se pueden subir ni quitar personajes: usa la aplicación para PC.' });

  if (ruta === '/personajes/subir') {
    if ((pide.headers['content-type'] || '') !== 'application/octet-stream') return json(400, { error: 'Formato no válido.' });
    return recibirArchivo(pide, url.searchParams.get('nombre'), json);
  }
  if (!(pide.headers['content-type'] || '').startsWith('application/json')) return json(400, { error: 'Formato no válido.' });
  const datos = await leerJSON(pide);
  if (!datos) return json(400, { error: 'Datos no válidos.' });
  const d = leer(), p = d.lista.find(x => x.id === datos.id);
  if (!p) return json(404, { error: 'Ese personaje ya no está.' });

  if (ruta === '/personajes/elegir') {
    d.actual = p.id; guardar(d); if (!WEB) avisar('personaje');
    return json(200, d);
  }
  if (ruta === '/personajes/ajustes') {
    p.ajustes = datos.ajustes && typeof datos.ajustes === 'object' ? datos.ajustes : null;
    guardar(d); if (!WEB) avisar('ajustes');
    return json(200, {});
  }
  if (ruta === '/personajes/foto') {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(datos.foto || '') || datos.foto.length > 100000) return json(400, { error: 'Foto no válida.' });
    p.foto = datos.foto; guardar(d);
    return json(200, {});
  }
  if (ruta === '/personajes/quitar') {
    if (p.id === ORIGINAL || p.incluido) return json(400, { error: 'Este personaje viene con la aplicación y no se puede quitar.' });
    d.lista = d.lista.filter(x => x.id !== p.id);
    const eraActual = d.actual === p.id;
    if (eraActual) d.actual = ORIGINAL;
    guardar(d);
    fs.rm(archivoDe(p.id), { force: true }, () => {});
    if (eraActual) avisar('personaje');
    return json(200, d);
  }
  json(404, { error: 'No existe.' });
}

module.exports = { atender };
