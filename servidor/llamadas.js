// Voz de Kusuri con Fish Audio y OBS para llamadas. OBS solo se abre cuando se prende desde la página.
const { spawn, execFile } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Readable } = require('stream');

const OBS_CARPETA = 'C:\\Program Files\\obs-studio\\bin\\64bit';
const OBS_DATOS = path.join(process.env.APPDATA || '', 'obs-studio');
const PERFIL = 'BaileVRM';
const VOZ_KUSURI = '1292328c2d1d41f7ad871e5d463d675d';
const MODELO_GRATIS = 's2.1-pro-free';

let estado = { fase: 'apagado', paso: 0, error: '' };
const descansar = ms => new Promise(r => setTimeout(r, ms));
const correr = (exe, args) => new Promise(r => execFile(exe, args, { windowsHide: true }, (e, salida) => r(String(salida || ''))));
const abierto = async nombre => (await correr('tasklist', ['/FI', 'IMAGENAME eq ' + nombre, '/NH'])).toLowerCase().includes(nombre.toLowerCase());

async function idDelCable() {
  const salida = await correr('powershell', ['-NoProfile', '-Command', "Get-PnpDevice -Class AudioEndpoint -Status OK | Where-Object FriendlyName -match 'CABLE Output' | Select-Object -First 1 -ExpandProperty InstanceId"]);
  const m = salida.match(/\{0\.0\.1\.[0-9a-f]+\}\.\{[0-9a-fA-F-]+\}/);
  return m ? m[0] : '';
}

// Perfil y escena propios: no se tocan los que ya existan en OBS
async function escribirOBS() {
  const carpetaPerfil = path.join(OBS_DATOS, 'basic', 'profiles', PERFIL);
  fs.mkdirSync(carpetaPerfil, { recursive: true });
  fs.mkdirSync(path.join(OBS_DATOS, 'basic', 'scenes'), { recursive: true });
  fs.writeFileSync(path.join(carpetaPerfil, 'basic.ini'), [
    '[General]', 'Name=' + PERFIL, '', '[Video]', 'BaseCX=1280', 'BaseCY=720', 'OutputCX=1280', 'OutputCY=720', 'FPSType=0', 'FPSCommon=30', '',
    '[Output]', 'Mode=Simple', '', '[SimpleOutput]', 'VBitrate=2500', 'ABitrate=128', 'StreamEncoder=nvenc', 'RecEncoder=nvenc', ''
  ].join('\r\n'));
  const item = (nombre, id) => ({ name: nombre, id, visible: true, locked: false, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rot: 0, align: 5, bounds_type: 0, bounds: { x: 0, y: 0 }, bounds_align: 0, crop_left: 0, crop_top: 0, crop_right: 0, crop_bottom: 0 });
  const fuente = (id, name, settings) => ({ id, versioned_id: id, name, settings, enabled: true, muted: false, volume: 1, mixers: 255, flags: 0, sync: 0 });
  fs.writeFileSync(path.join(OBS_DATOS, 'basic', 'scenes', PERFIL + '.json'), JSON.stringify({
    name: PERFIL, current_scene: 'Llamada', current_program_scene: 'Llamada', scene_order: [{ name: 'Llamada' }], groups: [], transitions: [], modules: {},
    sources: [
      fuente('scene', 'Llamada', { id_counter: 2, custom_size: false, items: [item('Personaje', 1), item('Voz', 2)] }),
      fuente('browser_source', 'Personaje', { url: 'http://localhost:' + (process.env.PORT || 8105) + '/?llamada=1', width: 1280, height: 720, fps_custom: true, fps: 30, shutdown: false, restart_when_active: false }),
      fuente('wasapi_input_capture', 'Voz', { device_id: await idDelCable(), use_device_timing: false })
    ]
  }));
}

// Si OBS no se cerró bien deja estas marcas y al abrirse queda parado en un aviso sin ventana
function quitarMarcaDeCierre() {
  const carpeta = path.join(OBS_DATOS, '.sentinel');
  try { for (const n of fs.readdirSync(carpeta)) if (n.startsWith('run_')) fs.unlinkSync(path.join(carpeta, n)); } catch (e) {}
}
// Solo se cierra el OBS abierto por este botón; uno abierto a mano no se toca
async function idsDeNuestroOBS() {
  const salida = await correr('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='obs64.exe'" | Where-Object { $_.CommandLine -match '--collection ${PERFIL}' } | ForEach-Object { $_.ProcessId }`]);
  return salida.split(/\s+/).filter(x => /^\d+$/.test(x));
}
async function cerrarNuestroOBS() {
  let ids = await idsDeNuestroOBS();
  if (!ids.length) return;
  for (const id of ids) await correr('taskkill', ['/PID', id]);
  for (let i = 0; i < 6 && ids.length; i++) { await descansar(1000); ids = await idsDeNuestroOBS(); }
  for (const id of ids) await correr('taskkill', ['/F', '/PID', id]);
  await descansar(500);
  quitarMarcaDeCierre();
}

async function prender() {
  if (estado.fase === 'prendiendo' || estado.fase === 'prendido') return;
  estado = { fase: 'prendiendo', paso: 1, error: '' };
  try {
    await cerrarNuestroOBS();
    if (await abierto('obs64.exe')) throw new Error('OBS ya está abierto. Ciérralo y vuelve a tocar el botón.');
    quitarMarcaDeCierre();
    if (!fs.existsSync(path.join(OBS_CARPETA, 'obs64.exe'))) throw new Error('Falta instalar OBS Studio en este PC.');
    await escribirOBS();
    spawn(path.join(OBS_CARPETA, 'obs64.exe'), ['--profile', PERFIL, '--collection', PERFIL, '--scene', 'Llamada', '--startvirtualcam', '--minimize-to-tray', '--enable-media-stream', '--disable-updater', '--disable-shutdown-check', '--disable-missing-files-check'],
      { cwd: OBS_CARPETA, detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    for (let i = 0; i < 30 && !(await abierto('obs64.exe')); i++) await descansar(1000);
    if (!(await abierto('obs64.exe'))) throw new Error('OBS no arrancó.');
    estado = { ...estado, fase: 'prendido', paso: 2 };
  } catch (e) {
    estado = { fase: 'error', paso: 0, error: e.message };
  }
}

async function apagar() {
  await cerrarNuestroOBS();
  estado = { fase: 'apagado', paso: 0, error: '' };
}

/* ---------- Voz de Fish Audio ---------- */
// La clave se lee de la variable de usuario de Windows y nunca sale de este servidor
async function claveFish() {
  if (process.env.FISH_API_KEY) return process.env.FISH_API_KEY;
  const salida = await correr('reg', ['query', 'HKCU\\Environment', '/v', 'FISH_API_KEY']);
  const m = salida.match(/FISH_API_KEY\s+REG_\w+\s+(\S+)/);
  return m ? m[1] : '';
}

const pedidos = new Map();
async function pedirVoz(texto) {
  const clave = await claveFish();
  if (!clave) return { codigo: 500, datos: { error: 'Falta la clave de Fish Audio en este PC.' } };
  const r = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json', model: MODELO_GRATIS },
    body: JSON.stringify({ text: texto, reference_id: VOZ_KUSURI, format: 'mp3', latency: 'balanced', chunk_length: 100 })
  });
  if (r.status === 402) return { codigo: 402, datos: { error: 'Fish Audio pide pago o no quedan créditos. No seguí con otra voz.' } };
  if (r.status === 429) return { codigo: 429, datos: { error: 'Fish Audio pide esperar un momento: se llegó al límite.' } };
  if (!r.ok) return { codigo: 502, datos: { error: 'Fish Audio respondió ' + r.status + '.' } };
  const id = crypto.randomUUID();
  // Si la página no lo usa pronto, se cierra para no dejar la conexión abierta
  pedidos.set(id, { cuerpo: r.body, espera: setTimeout(() => { pedidos.delete(id); r.body.cancel().catch(() => {}); }, 30000) });
  return { codigo: 200, datos: { id } };
}

const oyentesBoca = new Set();
function avisar(valor) { for (const o of oyentesBoca) o.write('data: ' + valor + '\n\n'); }

function leerJSON(pide) {
  return new Promise(res => {
    let t = '';
    pide.on('data', d => { t += d; if (t.length > 4000) pide.destroy(); });
    pide.on('end', () => { try { res(JSON.parse(t)); } catch (e) { res(null); } });
  });
}

// Solo este PC puede usar estas funciones, y solo desde esta misma página
function permitido(pide) {
  const ip = pide.socket.remoteAddress || '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return local && /^(localhost|127\.0\.0\.1):\d+$/.test(pide.headers.host || '');
}
const origenPropio = pide => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(pide.headers.origin || '');
async function atender(pide, responde) {
  const json = (codigo, datos) => { responde.writeHead(codigo, { 'Content-Type': 'application/json' }); responde.end(JSON.stringify(datos)); };
  if (!permitido(pide)) return json(403, { error: 'Solo funciona en este PC.' });
  const ruta = pide.url.split('?')[0];
  if (pide.method === 'GET') {
    if (ruta === '/llamadas/estado') return json(200, estado);
    if (ruta === '/voz/boca') {
      responde.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      oyentesBoca.add(responde);
      pide.on('close', () => oyentesBoca.delete(responde));
      return;
    }
    const m = ruta.match(/^\/voz\/audio\/([0-9a-f-]{36})$/);
    if (m && pedidos.has(m[1])) {
      const p = pedidos.get(m[1]);
      pedidos.delete(m[1]); clearTimeout(p.espera);
      responde.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      Readable.fromWeb(p.cuerpo).on('error', () => responde.destroy()).pipe(responde);
      return;
    }
    return json(404, { error: 'No existe.' });
  }
  if (pide.method !== 'POST') return json(405, { error: 'Método no permitido.' });
  // Otra página de internet no puede mandar esto: exige origen propio y JSON
  if (!origenPropio(pide) || !(pide.headers['content-type'] || '').startsWith('application/json')) return json(403, { error: 'Solo desde esta página.' });
  if (ruta === '/llamadas/prender') { prender(); return json(202, estado); }
  if (ruta === '/llamadas/apagar') { await apagar(); return json(200, estado); }
  const datos = await leerJSON(pide);
  if (ruta === '/llamadas/camara') { if (estado.fase === 'prendido' || estado.fase === 'prendiendo') estado.camara = { ok: !!(datos && datos.ok), motivo: String((datos && datos.motivo) || '').slice(0, 160) }; return json(200, {}); }
  if (ruta === '/llamadas/vista') { estado.cerca = !!(datos && datos.cerca); avisar('cerca:' + (estado.cerca ? 1 : 0)); return json(200, {}); }
  if (ruta === '/voz/boca') { avisar(Math.max(0, Math.min(1, Number(datos && datos.v) || 0))); return json(200, {}); }
  if (ruta === '/voz/pedir') {
    const texto = String((datos && datos.texto) || '').trim().slice(0, 400);
    if (!texto) return json(400, { error: 'No hay texto.' });
    try { const r = await pedirVoz(texto); return json(r.codigo, r.datos); }
    catch (e) { return json(502, { error: 'No hubo conexión con Fish Audio.' }); }
  }
  json(404, { error: 'No existe.' });
}

module.exports = { atender, permitido, origenPropio, avisar, apagar };
