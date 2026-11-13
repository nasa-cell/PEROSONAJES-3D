// Abre la aplicación en su propia ventana y, al cerrarla, apaga todo lo que quedó prendido.
const { spawn, execFile } = require('child_process');
const fs = require('fs'), path = require('path');
const { iniciar, PUERTO, apagarLlamada } = require('./servidor');

const SIN_NAVEGADOR = 3, PUERTO_OCUPADO = 4;
const DIRECCION = 'http://localhost:' + PUERTO + '/';
const PERFIL = path.join(process.env.LOCALAPPDATA || __dirname, 'BaileVRM', 'navegador');

function buscarNavegador() {
  const raices = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const rutas = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
  for (const r of rutas) for (const raiz of raices) {
    const p = path.join(raiz, r);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function abrirVentana(navegador) {
  return spawn(navegador, [
    '--app=' + DIRECCION, '--user-data-dir=' + PERFIL, '--no-first-run', '--no-default-browser-check', '--window-size=1280,760',
    // Con Meet delante, la voz y el personaje siguen trabajando igual
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'
  ], { stdio: 'ignore' });
}
const yaAbierta = () => fetch(DIRECCION + 'llamadas/estado', { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false);
// El navegador puede pasar la ventana a otro proceso propio: se espera a que no quede ninguno con este perfil
const quedanVentanas = () => new Promise(res => execFile('powershell', ['-NoProfile', '-Command',
  `@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${PERFIL.replace(/'/g, "''")}*' }).Count`],
{ windowsHide: true }, (e, salida) => res(parseInt(salida, 10) > 0)));

const traerAlFrente = () => new Promise(res => execFile('powershell', ['-NoProfile', '-Command',
  `$v = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${PERFIL.replace(/'/g, "''")}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1; if ($v) { [void](New-Object -ComObject WScript.Shell).AppActivate($v.ProcessId); 'si' }`],
{ windowsHide: true }, (e, salida) => res(String(salida).includes('si'))));

async function cerrarTodo() {
  await apagarLlamada().catch(() => {});
  process.exit(0);
}

(async () => {
  const navegador = buscarNavegador();
  if (!navegador) process.exit(SIN_NAVEGADOR);
  // Una segunda ventana duplicaría la voz: si ya está abierta, solo se trae al frente
  if (await yaAbierta()) {
    if (!(await traerAlFrente())) abrirVentana(navegador).unref();
    return setTimeout(() => process.exit(0), 500);
  }
  try { await iniciar(); } catch (e) { process.exit(PUERTO_OCUPADO); }
  abrirVentana(navegador).on('exit', async () => {
    while (await quedanVentanas()) await new Promise(r => setTimeout(r, 2000));
    cerrarTodo();
  }).on('error', () => process.exit(SIN_NAVEGADOR));
})();
