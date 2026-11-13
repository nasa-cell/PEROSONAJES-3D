import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, VRMExpression, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const $ = id => document.getElementById(id);
const aviso = (t) => { $('aviso').textContent = t; $('aviso').style.display = t ? 'block' : 'none'; };

/* ---------- Escena ---------- */
const lienzo = $('escena');
const render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, preserveDrawingBuffer: true });
render.setPixelRatio(Math.min(2, window.devicePixelRatio));
const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
camara.position.set(0, 1.0, 4.6);
const controles = new OrbitControls(camara, lienzo);
controles.target.set(0, 0.72, 0);
controles.enablePan = false; controles.minDistance = 1.5; controles.maxDistance = 8;
controles.update();
escena.add(new THREE.HemisphereLight(0xffffff, 0x9bb7ff, 1.6));
const sol = new THREE.DirectionalLight(0xffffff, 1.8); sol.position.set(1, 2, 3); escena.add(sol);
// Escenario: piso celeste con borde dorado (el fondo azul noche está en la página)
const piso = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.MeshBasicMaterial({ color: 0x93c5fd }));
piso.rotation.x = -Math.PI / 2; escena.add(piso);
const aro = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.12, 64), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
aro.rotation.x = -Math.PI / 2; aro.position.y = 0.002; escena.add(aro);

function ajustarTamano() {
  const w = window.innerWidth, h = window.innerHeight;
  render.setSize(w, h, false); camara.aspect = w / h;
  // En celular vertical se aleja un poco para que entre entero
  camara.fov = w < h ? 46 : 32;
  camara.updateProjectionMatrix();
}
window.addEventListener('resize', ajustarTamano); ajustarTamano();

/* ---------- Personaje ---------- */
let misPersonajes = { actual: 'original', lista: [{ id: 'original', nombre: 'Personaje original', ajustes: null, foto: '' }] }, revisionPersonaje = { clase: '', texto: '' };
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let vrm = null, reposo = {}, camaraLlamadaPedida = false;
const cargador = new GLTFLoader();
cargador.register(p => new VRMLoaderPlugin(p));
cargador.register(p => new VRMAnimationLoaderPlugin(p));

async function cargar(url, nombre) {
  aviso('Cargando personaje…');
  try {
    const gltf = await cargador.loadAsync(url);
    const nuevo = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(nuevo);
    nuevo.scene.traverse(o => { o.frustumCulled = false; });
    if (vrm) { escena.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
    vrm = nuevo; escena.add(vrm.scene);
    for (const k of Object.keys(ejesDedo)) delete ejesDedo[k];   // otro esqueleto: otros ejes de dedos
    reposo = { caderaY: hueso('hips').position.y, caderaPos: hueso('hips').position.clone() };
    medirReposo();
    prepararAnimaciones();
    aplicarAjustes();
    if ($('panel').classList.contains('ver')) dibujarPanel();
    if (vrm.lookAt) vrm.lookAt.target = camara;
    aviso(''); window.__listo = true;
    if (MODO_LLAMADA && !camaraLlamadaPedida) { camaraLlamadaPedida = true; $('camara').click(); if (!deCerca) $('cerca').click(); }
    if (!MODO_LLAMADA) setTimeout(guardarFotoSiFalta, 700);
    console.log('Personaje cargado:', nombre || url);
    return true;
  } catch (e) {
    console.warn(e); aviso('No pude abrir ese personaje (tiene que ser un archivo .vrm)'); return false;
  }
}
const hueso = n => vrm && vrm.humanoid.getNormalizedBoneNode(n);
const MODO_LLAMADA = new URLSearchParams(location.search).has('llamada');
if (MODO_LLAMADA) document.body.classList.add('llamada');
// Botones de la barra: ícono arriba y nombre abajo
function ponerTexto(b, t) {
  const i = t.indexOf(' ');
  b.innerHTML = `<i>${esc(t.slice(0, i))}</i><span>${esc(t.slice(i + 1))}</span>`;
}
document.querySelectorAll('.barra button').forEach(b => ponerTexto(b, b.textContent.trim()));
const gesto = (n, v) => { if (vrm && vrm.expressionManager) vrm.expressionManager.setValue(n, v); };

/* ---------- Baile (sin archivos de movimiento: todo calculado) ---------- */
const BPM = 112;
const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
const ondas = (b, f = 1, d = 0) => Math.sin((b * f + d) * Math.PI);    // 1 golpe = medio ciclo
const BRAZO_ABAJO = 1.25;

// Cada paso devuelve la pose para el golpe b (b = número de golpe con decimales)
const pasos = [
  // 1. Rebote con brazos que se balancean
  b => ({
    cadera: Math.abs(ondas(b)) * -0.05, giroCadera: ondas(b, 0.5) * 0.15,
    leftUpperArm: [ondas(b, 1) * 0.5, 0, -BRAZO_ABAJO], rightUpperArm: [-ondas(b, 1) * 0.5, 0, BRAZO_ABAJO],
    leftLowerArm: [0, -0.5, 0], rightLowerArm: [0, 0.5, 0],
    spine: [0.05, ondas(b, 0.5) * 0.15, ondas(b, 0.5) * 0.06], head: [Math.abs(ondas(b)) * 0.15, 0, 0],
    rodillas: Math.abs(ondas(b)) * 0.35
  }),
  // 2. Brazos arriba moviéndose de lado a lado
  b => ({
    cadera: Math.abs(ondas(b)) * -0.04, giroCadera: 0,
    leftUpperArm: [0, 0, 1.05 + ondas(b, 0.5) * 0.25], rightUpperArm: [0, 0, -1.05 + ondas(b, 0.5) * 0.25],
    leftLowerArm: [0, 0, 0.3], rightLowerArm: [0, 0, -0.3],
    spine: [0, 0, ondas(b, 0.5) * 0.18], head: [0.05, 0, ondas(b, 0.5) * -0.15],
    rodillas: Math.abs(ondas(b)) * 0.3
  }),
  // 3. Aplausos adelante
  b => {
    const junta = Math.abs(ondas(b));
    return {
      cadera: junta * -0.04, giroCadera: ondas(b, 0.25) * 0.2,
      leftUpperArm: [0, -0.55 - junta * 0.3, -0.9], rightUpperArm: [0, 0.55 + junta * 0.3, 0.9],
      leftLowerArm: [0, -0.8, 0], rightLowerArm: [0, 0.8, 0],
      spine: [0.08, ondas(b, 0.25) * 0.2, 0], head: [junta * 0.12, ondas(b, 0.25) * 0.2, 0],
      rodillas: junta * 0.3
    };
  },
  // 4. Señala arriba, una mano y la otra (paso de disco)
  b => {
    const lado = Math.floor(b / 2) % 2 === 0 ? 1 : -1, s = Math.abs(ondas(b, 0.5));
    const arriba = [0, 0, 1.6], cintura = [0, 0.8, 0];
    return {
      cadera: s * -0.05, giroCadera: lado * 0.25,
      leftUpperArm: lado > 0 ? [-0.3, 0, 0.6 + s * 0.5] : [0.2, 0.6, -1.1], rightUpperArm: lado < 0 ? [-0.3, 0, -0.6 - s * 0.5] : [0.2, -0.6, 1.1],
      leftLowerArm: lado > 0 ? [0, 0, 0] : [0, -1.6, 0], rightLowerArm: lado < 0 ? [0, 0, 0] : [0, 1.6, 0],
      spine: [0, lado * 0.15, lado * -0.12], head: [-0.1, lado * 0.3, 0],
      rodillas: s * 0.35, arriba, cintura
    };
  }
];
const HUESOS_POSE = ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'spine', 'head'];

function poseDe(paso, b) {
  const p = pasos[paso](b), r = {};
  for (const n of HUESOS_POSE) r[n] = q(...p[n]);
  r.hips = q(0, p.giroCadera, 0);
  r.leftUpperLeg = q(-p.rodillas, 0, 0.05); r.rightUpperLeg = q(-p.rodillas, 0, -0.05);
  r.leftLowerLeg = q(p.rodillas * 1.9, 0, 0); r.rightLowerLeg = q(p.rodillas * 1.9, 0, 0);
  r.leftFoot = q(-p.rodillas * 0.9, 0, 0); r.rightFoot = q(-p.rodillas * 0.9, 0, 0);
  r.cadera = p.cadera - p.rodillas * 0.12;
  return r;
}

let inicioBaile = performance.now(), parpadeo = 0;
function bailar(ahora) {
  const b = Math.max(0, ahora - inicioBaile) / 1000 * BPM / 60;
  const GOLPES = 8, paso = Math.floor(b / GOLPES) % pasos.length;
  let pose = poseDe(paso, b);
  // Medio golpe antes de cambiar de paso, se mezcla con el siguiente (sin saltos)
  const resto = GOLPES - (b % GOLPES);
  if (resto < 1) {
    const sig = poseDe((paso + 1) % pasos.length, b), t = 1 - resto;
    const s = t * t * (3 - 2 * t);
    for (const n in pose) if (pose[n] instanceof THREE.Quaternion) pose[n].slerp(sig[n], s);
    pose.cadera += (sig.cadera - pose.cadera) * s;
  }
  for (const n in pose) if (pose[n] instanceof THREE.Quaternion) { const h = hueso(n); if (h) h.quaternion.slerp(pose[n], 0.5); }
  const cadera = hueso('hips'); if (cadera) cadera.position.y = reposo.caderaY + pose.cadera;
  // Dedos un poco cerrados y cara alegre
  for (const lado of ['left', 'right']) for (const d of ['Index', 'Middle', 'Ring', 'Little']) for (const f of ['Proximal', 'Intermediate']) {
    const h = hueso(lado + d + f); if (h) h.quaternion.slerp(q(0, 0, (lado === 'left' ? -1 : 1) * 0.35), 0.3);
  }
  gesto('happy', 0.7);
  gesto('aa', 0);
  // Parpadea cada tanto
  if (ahora > parpadeo) parpadeo = ahora + 2500 + Math.random() * 2500;
  const falta = parpadeo - ahora;
  gesto('blink', falta < 150 ? 1 - Math.abs(falta - 75) / 75 : 0);
}

/* ---------- Cámara: copia cuerpo, manos y cara ---------- */
let modo = 'bailar', detectores = null, video = $('video'), ultimoVideo = -1, turno = 0;
let persona = null, poseDos = false, ultimaPose = null, ultimaCara = null, manos = { Left: null, Right: null };
const visto = { cuerpo: false, brazos: 0, manos: 0, cara: false, pies: false };
let hombrosDePie = null, desdeCuatro = 0, cuatroPatas = false, giroCadera = null;
// Lo que ve la cámara, dibujado sobre la imagen chica (así se sabe si te está siguiendo)
const puntos = $('puntos'), pctx = puntos.getContext('2d');
const HUESOS_CUERPO = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32],[15,17],[15,19],[15,21],[17,19],[16,18],[16,20],[16,22],[18,20],[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10]];
const HUESOS_MANO = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function dibujarPuntos() {
  puntos.width = video.videoWidth || 640; puntos.height = video.videoHeight || 480;
  pctx.clearRect(0, 0, puntos.width, puntos.height);
  const W = puntos.width, H = puntos.height;
  const pinta = (lista, color, r) => { pctx.fillStyle = color; for (const p of lista) { if (!p) continue; pctx.beginPath(); pctx.arc(p.x * W, p.y * H, r, 0, 7); pctx.fill(); } };
  const une = (lista, pares, color, ancho) => {
    pctx.strokeStyle = color; pctx.lineWidth = ancho; pctx.beginPath();
    for (const [a, b] of pares) { const p = lista[a], q = lista[b]; if (!p || !q) continue; pctx.moveTo(p.x * W, p.y * H); pctx.lineTo(q.x * W, q.y * H); }
    pctx.stroke();
  };
  // Cara: todos sus puntos (478)
  if (ultimaCara) pinta(ultimaCara, 'rgba(34,197,94,.85)', 1.6);
  // Cuerpo: los 33 puntos unidos como esqueleto
  if (ultimaPose) {
    const P = ultimaPose.l.map(p => (p.visibility ?? 1) > 0.5 ? p : null);
    une(P, HUESOS_CUERPO, 'rgba(59,130,246,.9)', 3);
    pinta(P, '#1d4ed8', 5);
  }
  // Manos: 21 puntos cada una, unidos dedo por dedo
  for (const l of ['Left', 'Right']) if (manos[l]) { une(manos[l], HUESOS_MANO, 'rgba(245,158,11,.9)', 2); pinta(manos[l], '#f59e0b', 3.2); }
  const si = v => v ? '✔' : '✖';
  $('estado').textContent = `Te veo · cuerpo ${si(visto.cuerpo)} · brazos ${visto.brazos}/2 · manos ${visto.manos}/2 · cara ${si(visto.cara)}` +
    (visto.cuerpo && !visto.pies && !deCerca ? ' · No veo tus pies: aléjate unos pasos' : '');
}

let motivoCamara = '';
async function prenderCamara() {
  motivoCamara = '';
  aviso('Pidiendo la cámara…');
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
    video.srcObject = flujo; await video.play(); $('vista').style.display = 'block';
  } catch (e) { motivoCamara = e.name + ': ' + e.message; aviso('No pude abrir la cámara: revisa el permiso del navegador'); return false; }
  if (!detectores) {
    aviso('Preparando la detección (la primera vez tarda unos segundos)…');
    try {
      const { FilesetResolver, PoseLandmarker, HandLandmarker, FaceLandmarker } = await import('vision');
      const archivos = await FilesetResolver.forVisionTasks(new URL('librerias/mediapipe/wasm', location.href).href);
      // Primero con la tarjeta de video; si esa no anda en este equipo, con el procesador
      const opcionesPose = { numPoses: 1, minPoseDetectionConfidence: 0.4, minTrackingConfidence: 0.4 };
      const crear = async (Clase, modelo, extra, runningMode = 'VIDEO') => {
        for (const delegate of ['GPU', 'CPU']) {
          try { return await Clase.createFromOptions(archivos, { baseOptions: { modelAssetPath: modelo, delegate }, runningMode, ...extra }); }
          catch (e) { console.warn(modelo, delegate, e); }
        }
        throw new Error('no pude preparar ' + modelo);
      };
      detectores = {
        // Cuerpo: detector «completo» (el «pesado» se probó y copiaba peor)
        pose: await crear(PoseLandmarker, 'modelos/pose-completo.task', opcionesPose),
        manos: await crear(HandLandmarker, 'modelos/manos.task', { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }),
        cara: await crear(FaceLandmarker, 'modelos/cara.task', { numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true }),
        // Manos lejanas: se busca la mano en la zona ampliada alrededor de tu muñeca (como Holistic)
        manoRecorte: await crear(HandLandmarker, 'modelos/manos.task', { numHands: 1, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.5 }, 'IMAGE')
      };
      cargarEmocion();
    } catch (e) {
      console.warn(e); aviso('No pude preparar la detección: revisa que haya internet y recarga la página'); return false;
    }
  }
  aviso(''); return true;
}

// Manos lejanas: si el detector no ve una mano pero se ve tu muñeca, se amplía la zona alrededor de ella
// (la mano se ve chica cuando estás de cuerpo entero) y se busca ahí. Va en pocos cuadros, para no frenar.
const lienzoMano = document.createElement('canvas'); lienzoMano.width = lienzoMano.height = 224;
let turnoMano = 0;
function manoEnRecorte(lado, vw, vh) {
  const P = ultimaPose && ultimaPose.l; if (!P || !detectores.manoRecorte) return null;
  const [codo, muneca] = lado === 'left' ? [14, 16] : [13, 15];
  if ((P[muneca].visibility ?? 1) < 0.5 || (P[codo].visibility ?? 1) < 0.3) return null;
  const ex = P[codo].x * vw, ey = P[codo].y * vh, wx = P[muneca].x * vw, wy = P[muneca].y * vh, ante = Math.hypot(wx - ex, wy - ey);
  // solo cuando la mano se ve chica (lejos): de cerca el detector normal ya la encuentra
  if (ante < 8 || ante > 0.22 * vh) return null;
  const lado2 = Math.max(48, ante * 1.6), x0 = wx + (wx - ex) * 0.35 - lado2 / 2, y0 = wy + (wy - ey) * 0.35 - lado2 / 2;
  const g = lienzoMano.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 224, 224);
  g.drawImage(video, x0, y0, lado2, lado2, 0, 0, 224, 224);
  const r = detectores.manoRecorte.detect(lienzoMano);
  if (!r.landmarks || !r.landmarks[0] || r.handedness[0][0].score < 0.6) return null;
  const lm = r.landmarks[0].map(p => ({ x: (x0 + p.x * lado2) / vw, y: (y0 + p.y * lado2) / vh, z: p.z * lado2 / vw }));
  // tiene que nacer en tu muñeca: si no, era otra cosa
  return Math.hypot(lm[0].x * vw - wx, lm[0].y * vh - wy) < 0.6 * ante ? lm : null;
}

function apagarCamara() {
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  video.srcObject = null; $('vista').style.display = 'none';
}

/* El personaje copia en 3D, como un espejo. Cada hueso se apunta hacia donde va tu
   brazo, tu mano o tu dedo (no se calculan ángulos sueltos): así la mano llega a la cara
   si tú la llevas a la cara. La cámara da los puntos en metros, con el centro en tu cadera. */
const PRUEBA = new URLSearchParams(location.search);   // solo para las pruebas
const v3 = () => new THREE.Vector3(), q4 = () => new THREE.Quaternion();
const espejo = p => new THREE.Vector3(-p.x, -p.y, -p.z);       // tu derecha queda a la derecha de la pantalla
let reposoDir = {}, rotEscena = q4();

// Al cargar: hacia dónde apunta cada hueso cuando el personaje está en reposo (brazos en T)
function medirReposo() {
  vrm.humanoid.resetNormalizedPose();
  vrm.scene.updateMatrixWorld(true);
  vrm.scene.getWorldQuaternion(rotEscena);
  const pos = n => { const h = hueso(n); return h ? h.getWorldPosition(v3()) : null; };
  const dir = (a, b) => { const pa = pos(a), pb = pos(b); return pa && pb ? pb.sub(pa).normalize() : null; };
  reposoDir = {};
  for (const l of ['left', 'right']) {
    reposoDir[l + 'UpperArm'] = dir(l + 'UpperArm', l + 'LowerArm');
    reposoDir[l + 'LowerArm'] = dir(l + 'LowerArm', l + 'Hand');
    reposoDir[l + 'HandAdelante'] = dir(l + 'Hand', l + 'MiddleProximal');
    reposoDir[l + 'HandLado'] = dir(l + 'IndexProximal', l + 'LittleProximal');
    for (const [d, partes] of Object.entries(DEDOS)) {
      for (let k = 0; k < partes.length; k++) {
        const n = l + d + partes[k], sig = partes[k + 1] ? l + d + partes[k + 1] : null;
        reposoDir[n] = sig ? dir(n, sig) : dir(l + d + partes[k - 1], n);
      }
    }
  }
  reposoDir.torsoArriba = dir('hips', 'neck');
  reposoDir.torsoLado = dir('rightUpperArm', 'leftUpperArm');
  // Eje del codo en reposo: el codo es una bisagra que dobla el antebrazo hacia adelante
  const frente = v3().crossVectors(reposoDir.torsoLado, reposoDir.torsoArriba).normalize();
  reposoDir.frente = frente;
  for (const l of ['left', 'right']) reposoDir[l + 'Bisagra'] = v3().crossVectors(reposoDir[l + 'UpperArm'], frente).normalize();
  medirCuerpo();
}
const DEDOS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'],
  Middle: ['Proximal', 'Intermediate', 'Distal'], Ring: ['Proximal', 'Intermediate', 'Distal'], Little: ['Proximal', 'Intermediate', 'Distal'] };
// Puntos de la mano (0 = muñeca) para cada parte de cada dedo: [desde, hasta]
const PUNTOS_DEDO = { Thumb: [[1, 2], [2, 3], [3, 4]], Index: [[5, 6], [6, 7], [7, 8]], Middle: [[9, 10], [10, 11], [11, 12]],
  Ring: [[13, 14], [14, 15], [15, 16]], Little: [[17, 18], [18, 19], [19, 20]] };

// Pone un hueso para que en el mundo quede girado «giro» respecto de su reposo
// (el suavizado se hace en el mundo: si el hueso de arriba se mueve, este no salta)
function ponerGiroMundo(nombre, giro, suave) {
  const h = hueso(nombre); if (!h || !giro) return;
  const objetivo = giro.clone().multiply(rotEscena);                  // rotación final en el mundo
  const ahora = h.getWorldQuaternion(q4()).slerp(objetivo, suave);
  h.quaternion.copy(h.parent.getWorldQuaternion(q4()).invert().multiply(ahora));
  h.updateWorldMatrix(false, true);
}
// Apunta un hueso hacia una dirección (sin girarlo sobre sí mismo)
// Gira desde donde está ahora (no desde el reposo): así el brazo nunca se tuerce media vuelta de golpe
function apuntar(nombre, haciaDonde, suave = 0.5) {
  const d0 = reposoDir[nombre], h = hueso(nombre); if (!d0 || !h || !haciaDonde || haciaDonde.lengthSq() < 1e-8) return;
  const objetivo = haciaDonde.clone().normalize();
  const giroAhora = h.getWorldQuaternion(q4()).multiply(rotEscena.clone().invert());
  const giro = q4().setFromUnitVectors(d0.clone().applyQuaternion(giroAhora), objetivo).multiply(giroAhora);
  // poco a poco vuelve a la torsión natural, para que no se acumule
  const natural = q4().setFromUnitVectors(d0, objetivo);
  if (giro.angleTo(natural) < Math.PI / 2) giro.slerp(natural, 0.03);
  ponerGiroMundo(nombre, giro, suave);
}
// Giro que lleva una base (adelante + lado) de reposo a la medida (para mano y torso)
function giroDeBase(adelante0, lado0, adelante, lado) {
  const base = (a, b) => {
    const x = a.clone().normalize(), z = v3().crossVectors(x, b).normalize(), y = v3().crossVectors(z, x);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const m = base(adelante, lado).multiply(base(adelante0, lado0).transpose());
  return q4().setFromRotationMatrix(m);
}

// Filtro suave inteligente: si el punto está casi quieto lo deja quieto (sin temblor);
// si se mueve rápido lo sigue enseguida (sin atraso). Es el filtro «1 euro».
const filtros = {};
function filtrar(clave, lista, t, minCorte, beta) {
  let f = filtros[clave];
  if (!f || f.puntos.length !== lista.length || t - f.t > 400) {
    filtros[clave] = { t, puntos: lista.map(p => p.clone()), vel: lista.map(() => v3()) };
    return filtros[clave].puntos.map(p => p.clone());
  }
  const dt = Math.max(1e-3, (t - f.t) / 1000); f.t = t;
  const alfa = corte => 1 / (1 + 1 / (2 * Math.PI * corte * dt));
  const aV = alfa(1.0);
  lista.forEach((p, i) => {
    const vel = p.clone().sub(f.puntos[i]).divideScalar(dt);
    f.vel[i].lerp(vel, aV);
    f.puntos[i].lerp(p, alfa(minCorte + beta * f.vel[i].length()));
  });
  return f.puntos.map(p => p.clone());
}
// Puntos del cuerpo «igual a la imagen»: el ancho y el alto salen de la imagen (lo más exacto)
// y la profundidad del modelo 3D, pasada a la misma medida. Todo en espejo.
let pxPorMetro = 0;
function poseIgualImagen(l, w, vw, vh) {
  let r = 0;
  for (const [a, b] of [[11, 12], [11, 23], [12, 24], [11, 13], [12, 14], [13, 15], [14, 16], [23, 25], [24, 26]]) {
    if ((l[a].visibility ?? 1) < 0.5 || (l[b].visibility ?? 1) < 0.5) continue;
    const dw = Math.hypot(w[a].x - w[b].x, w[a].y - w[b].y, w[a].z - w[b].z); if (dw < 0.08) continue;
    // un hueso que apunta a la cámara se ve más corto: el que se ve más largo da la medida justa
    r = Math.max(r, Math.hypot((l[a].x - l[b].x) * vw, (l[a].y - l[b].y) * vh) / dw);
  }
  if (r) pxPorMetro = pxPorMetro ? pxPorMetro + (r - pxPorMetro) * 0.1 : r;
  const s = pxPorMetro || vh;
  return l.map((p, i) => new THREE.Vector3(-p.x * vw, -p.y * vh, -w[i].z * s));
}
const manoIgualImagen = (lm, vw, vh) => lm.map(p => new THREE.Vector3(-p.x * vw, -p.y * vh, -p.z * vw));

// Medidas del personaje en reposo (largo de brazos, distancia entre ojos, altura de los pies)
let medidas = {}, destinos = {}, piernasVistas = -1e9, ojosRecordados = null;
function medirCuerpo() {
  const pos = n => { const h = hueso(n); return h ? h.getWorldPosition(v3()) : null; };
  const largo = (a, b) => pos(a).distanceTo(pos(b));
  medidas = {};
  for (const l of ['left', 'right']) {
    medidas[l + 'Brazo'] = largo(l + 'UpperArm', l + 'LowerArm');
    medidas[l + 'Antebrazo'] = largo(l + 'LowerArm', l + 'Hand');
  }
  const oi = pos('leftEye'), od = pos('rightEye');
  medidas.ojoDist = oi && od && oi.distanceTo(od) > 0.02 ? oi.distanceTo(od) : 0.065;
  medidas.pieY = Math.min(pos('leftFoot').y, pos('rightFoot').y);
  medidas.torso = pos('leftUpperArm').distanceTo(pos('leftUpperLeg'));
  medidas.dedoY = pos('leftToes') ? pos('leftToes').y : medidas.pieY;
  prepararGestos();
  medirSuperficie();
  medirCaraAvatar();
  reposoDir.caderaLado = pos('leftUpperLeg').sub(pos('rightUpperLeg')).normalize();
  for (const l of ['left', 'right']) {
    reposoDir[l + 'UpperLeg'] = pos(l + 'LowerLeg').sub(pos(l + 'UpperLeg')).normalize();
    reposoDir[l + 'LowerLeg'] = pos(l + 'Foot').sub(pos(l + 'LowerLeg')).normalize();
    const dedo = pos(l + 'Toes');
    reposoDir[l + 'Foot'] = dedo ? dedo.sub(pos(l + 'Foot')).normalize() : new THREE.Vector3(0, -0.3, 1).normalize();
  }
}
// Lo que toca el piso es lo que está más abajo: pies, dedos, rodillas o manos. El cuerpo baja o sube
// hasta que ese punto quede apoyado (nada se hunde), y al saltar se despega del piso
function apoyarEnPiso(salto, suave) {
  vrm.scene.updateMatrixWorld(true);
  const altura = (n, resta) => { const h = hueso(n); return h ? h.getWorldPosition(v3()).y - resta : Infinity; };
  let bajo = Infinity;
  for (const l of ['left', 'right']) bajo = Math.min(bajo, altura(l + 'Foot', medidas.pieY), altura(l + 'Toes', medidas.dedoY), altura(l + 'LowerLeg', 0.055), altura(l + 'Hand', 0.03));
  const h = hueso('hips'); if (h && bajo < Infinity) h.position.y += Math.max(-0.9, Math.min(0.3, salto - bajo)) * suave;
}
// De frente, una rodilla en el piso se ve como una pierna corta: el muslo se ve entero y la canilla casi
// no se ve porque va hacia atrás. Tu tobillo queda tapado, así que el detector duda de él (no sirve pedirle seguridad)
const rodillaEnPiso = { left: { si: false, t: -1e9 }, right: { si: false, t: -1e9 } };
function medirRodillas(P, w, vw, vh, ahora) {
  const largo = (a, b) => Math.hypot((P[a].x - P[b].x) * vw, (P[a].y - P[b].y) * vh);
  const torso = (largo(11, 23) + largo(12, 24)) / 2;
  for (const [l, cad, rod, tob] of [['left', 24, 26, 28], ['right', 23, 25, 27]]) {
    const parece = torso > 5 && Math.abs(P[11].x - P[12].x) < 0.3 && P[cad].y < 0.95 && (P[cad].visibility ?? 1) > 0.3 && P[rod].y < 0.97 && P[rod].y > P[cad].y &&
      largo(cad, rod) / torso > 0.55 && largo(rod, tob) / torso < 0.5 && w[tob].y - w[rod].y < 0.2 && w[tob].z - w[rod].z > 0.22;
    const e = rodillaEnPiso[l];
    if (parece === e.si) e.t = ahora;
    else if (ahora - e.t > (parece ? 120 : 250)) { e.si = parece; e.t = ahora; }
  }
  return rodillaEnPiso;
}
// Salto: tus dos pies suben juntos en la imagen. Si te alejas de la cámara también suben,
// pero entonces tu torso se ve más chico: eso no cuenta como salto
let pisoImagen = null, torsoImagen = null, ultimoSalto = -1e9;
function medirSalto(P, vh, ahora) {
  const claro = i => (P[i].visibility ?? 1) > 0.5 && P[i].y < 0.99;
  if (!claro(27) || !claro(28) || !claro(23) || !claro(24)) { pisoImagen = null; return 0; }
  const y = Math.max(P[27].y, P[28].y) * vh;
  const torso = Math.abs((P[11].y + P[12].y - P[23].y - P[24].y) / 2) * vh; if (torso < 5) return 0;
  const dt = Math.min(0.1, Math.max(0.001, (ahora - ultimoSalto) / 1000)); ultimoSalto = ahora;
  if (pisoImagen === null) { pisoImagen = y; torsoImagen = torso; return 0; }
  pisoImagen = y > pisoImagen ? pisoImagen + (y - pisoImagen) * 0.5 : pisoImagen + (y - pisoImagen) * Math.min(1, dt * 1.2);
  torsoImagen += (torso - torsoImagen) * Math.min(1, dt * 1.2);
  const sube = (pisoImagen - y) / torsoImagen;
  if (torso < torsoImagen * 0.88 || sube < 0.1) return 0;
  return Math.min(1.2, sube) * medidas.torso;
}
// Expresiones: cada persona tiene su cara en calma (cejas bajas, lentes...), así que se mide
// cuánto cambió respecto de esa calma, no el valor directo
const calma = {};
let calmaDesde = null;
function cambio(clave, v, dt, ahora) {
  if (calmaDesde === null) calmaDesde = ahora;
  if (calma[clave] === undefined) calma[clave] = v;
  const rapido = ahora - calmaDesde < 2000;
  calma[clave] += (v - calma[clave]) * Math.min(1, dt * (rapido ? 2.5 : 0.03));
  return v - calma[clave];
}
const entre01 = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
function medirEmocion(G, L, dt, ahora) {
  const bs = n => cambio(n, G[n] || 0, dt, ahora), par = (a, b) => (bs(a) + bs(b)) / 2;
  const h = Math.hypot(L[10].x - L[152].x, L[10].y - L[152].y) || 1, y = i => L[i].y / h;
  const cejaOjo = cambio('cejaOjo', 100 * ((y(159) + y(386)) - (y(55) + y(285))) / 2, dt, ahora);
  const comisura = cambio('comisura', 100 * ((y(61) + y(291)) / 2 - (y(13) + y(14)) / 2), dt, ahora);
  const cejaBaja = par('browDownLeft', 'browDownRight'), cejaAdentro = bs('browInnerUp'), cejaAfuera = par('browOuterUpLeft', 'browOuterUpRight');
  const risa = par('mouthSmileLeft', 'mouthSmileRight'), triste1 = par('mouthFrownLeft', 'mouthFrownRight'), aprieta = par('mouthPressLeft', 'mouthPressRight');
  const labio = bs('mouthRollLower'), menton = bs('mouthShrugLower'), ojoAncho = par('eyeWideLeft', 'eyeWideRight'), entorna = par('eyeSquintLeft', 'eyeSquintRight');
  const feliz = entre01(risa, 0.12, 0.55);
  const enojo = Math.max(entre01(cejaBaja, 0.08, 0.32), entre01(-cejaOjo, 1.5, 4.5)) * (1 - feliz);
  const bocaTriste = Math.max(entre01(triste1, 0.03, 0.2), entre01(comisura, 0.8, 2.5), entre01(aprieta * 0.5 + labio * 0.5 + menton * 0.5, 0.08, 0.2));
  const triste = bocaTriste * (1 - feliz) * (1 - 0.6 * enojo);
  // sorpresa: cejas arriba u ojos muy abiertos, y más todavía si además abres la boca
  const cejasArriba = entre01((cejaAdentro + cejaAfuera) / 2, 0.1, 0.35), bocaAbierta = entre01(bs('jawOpen'), 0.1, 0.35);
  const sorpresa = Math.min(1, Math.max(entre01(ojoAncho, 0.08, 0.3), cejasArriba) * (0.75 + 0.5 * bocaAbierta)) * (1 - enojo) * (1 - feliz);
  return { feliz, enojo, triste, sorpresa, entorna: entre01(entorna, 0.1, 0.5), cejaTriste: Math.max(triste, entre01(cejaAdentro - cejaAfuera, 0.1, 0.35) * (1 - enojo)) };
}
// Gestos sueltos (cejas, ojos y boca por separado) con las formas de cara que trae el personaje.
// Así sonreír no le cierra los ojos. Un personaje sin esas formas usa sus gestos completos
const FORMAS_CARA = { cejaEnojo: 'Fcl_BRW_Angry', ojoEnojo: 'Fcl_EYE_Angry', bocaEnojo: 'Fcl_MTH_Angry', cejaTriste: 'Fcl_BRW_Sorrow', ojoTriste: 'Fcl_EYE_Sorrow', bocaTriste: 'Fcl_MTH_Sorrow',
  cejaFeliz: 'Fcl_BRW_Joy', ojoFeliz: 'Fcl_EYE_Joy', bocaFeliz: 'Fcl_MTH_Joy', cejaSorpresa: 'Fcl_BRW_Surprised', ojoSorpresa: 'Fcl_EYE_Surprised', bocaSorpresa: 'Fcl_MTH_Surprised' };
let formasSueltas = false;
function prepararGestos() {
  formasSueltas = false;
  if (!vrm.expressionManager) return;
  const mallas = []; vrm.scene.traverse(o => { if (o.isMesh && o.morphTargetDictionary) mallas.push(o); });
  for (const [nombre, forma] of Object.entries(FORMAS_CARA)) {
    const con = mallas.filter(m => m.morphTargetDictionary[forma] !== undefined);
    if (!con.length) return;
    if (vrm.expressionManager.getExpression(nombre)) continue;
    const ex = new VRMExpression(nombre);
    vrm.scene.add(ex);
    for (const m of con) ex.addBind(new VRMExpressionMorphTargetBind({ primitives: [m], index: m.morphTargetDictionary[forma], weight: 1 }));
    vrm.expressionManager.registerExpression(ex);
  }
  formasSueltas = true;
}
// Modelo entrenado para reconocer emociones. Mira tu cara unas 5 veces por segundo, sin frenar lo demás.
// Si no carga en esta PC, las expresiones siguen con las medidas de la cara
const CLASES_EMOCION = ['enojo', 'desprecio', 'asco', 'miedo', 'alegria', 'neutro', 'tristeza', 'sorpresa'];
let sesionEmocion = null, ortEmocion = null, ocupadoEmocion = false, horaEmocion = -1e9, probEmocion = null;
const lienzoEmocion = document.createElement('canvas'); lienzoEmocion.width = lienzoEmocion.height = 224;
async function cargarEmocion() {
  if (sesionEmocion) return;
  try {
    ortEmocion = await import('onnxruntime-web');
    ortEmocion.env.wasm.wasmPaths = new URL('librerias/ort/', location.href).href;
    sesionEmocion = await ortEmocion.InferenceSession.create('modelos/emocion.onnx', { executionProviders: ['webgpu', 'wasm'] });
  } catch (e) { console.warn('emociones', e); }
}
async function mirarEmocion(L, vw, vh, ahora) {
  if (!sesionEmocion || ocupadoEmocion || ahora - horaEmocion < 200) return;
  ocupadoEmocion = true; horaEmocion = ahora;
  try {
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    for (const q of L) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const g = lienzoEmocion.getContext('2d', { willReadFrequently: true });
    g.drawImage(video, x0 * vw, y0 * vh, (x1 - x0) * vw, (y1 - y0) * vh, 0, 0, 224, 224);
    const pix = g.getImageData(0, 0, 224, 224).data, n = 224 * 224, d = new Float32Array(n * 3), media = [0.485, 0.456, 0.406], desv = [0.229, 0.224, 0.225];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) d[k * n + i] = (pix[i * 4 + k] / 255 - media[k]) / desv[k];
    const r = await sesionEmocion.run({ [sesionEmocion.inputNames[0]]: new ortEmocion.Tensor('float32', d, [1, 3, 224, 224]) });
    const v = Array.from(r[sesionEmocion.outputNames[0]].data), mx = Math.max(...v), e = v.map(x => Math.exp(x - mx)), su = e.reduce((a, b) => a + b, 0);
    probEmocion = { t: performance.now(), ...Object.fromEntries(CLASES_EMOCION.map((c, i) => [c, e[i] / su])) };
  } catch (e) { console.warn('emociones', e); }
  ocupadoEmocion = false;
}
function emocionDelModelo(em) {
  if (!probEmocion || performance.now() - probEmocion.t > 800) return em;
  const p = probEmocion, f = v => entre01(v, 0.3, 0.7);
  // Mirando abajo o de costado la cara parece triste o enojada sin estarlo: ahí el modelo cuenta menos
  let seguro = 1;
  if (caraMatriz) {
    const eu = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().fromArray(caraMatriz), 'YXZ');
    seguro = 1 - 0.8 * Math.max(entre01(Math.abs(eu.x), 0.2, 0.45), entre01(Math.abs(eu.y), 0.35, 0.7));
  }
  // se juntan las dos lecturas (el modelo mira la foto de la cara; los gestos, los músculos): gana la más clara
  const feliz = Math.max(f(p.alegria), em.feliz), enojo = f(p.enojo + p.asco * 0.5 + p.desprecio * 0.3) * (1 - feliz) * seguro;
  const triste = entre01(p.tristeza, 0.27, 0.65) * (1 - feliz) * seguro;
  const sorpresa = Math.max(entre01(p.sorpresa + p.miedo * 0.5, 0.2, 0.6), em.sorpresa) * (1 - feliz) * (1 - 0.7 * enojo);
  return { ...em, feliz, enojo, triste, sorpresa, cejaTriste: Math.max(triste, f(p.miedo) * 0.5) };
}
// Emociones como el código VTuber: cada una sale de los músculos que la hacen y gana solo la más clara
// (cejas abajo = enojo, no tristeza; tristeza = comisuras abajo + cejas de adentro arriba)
function emocionVtuber(G, em) {
  const g = k => G[k] || 0, c = v => Math.max(0, Math.min(1, v));
  const sonrisa = c(((g('mouthSmileLeft') + g('mouthSmileRight')) / 2 - 0.15) / 0.45);
  const boca = c((g('jawOpen') - 0.03) / 0.35);
  const cejas = c((g('browInnerUp') * 0.6 + (g('browOuterUpLeft') + g('browOuterUpRight')) * 0.2 - 0.08) / 0.45);
  const ceno = c(((g('browDownLeft') + g('browDownRight')) / 2 * 0.8 + (g('noseSneerLeft') + g('noseSneerRight')) / 2 * 0.4 - 0.12) / 0.4);
  const tristeza = c(((g('mouthFrownLeft') + g('mouthFrownRight')) / 2 * 0.8 + g('browInnerUp') * 0.3 - 0.1) / 0.4) * (1 - ceno);
  let sorpresa = Math.min(cejas, boca * 1.6) * 0.9;
  const op = { feliz: sonrisa, enojo: ceno, triste: tristeza, sorpresa };
  // el detector de emociones (mira la foto de tu cara) ayuda donde los músculos se notan poco, sobre todo la tristeza;
  // pero si frunces el ceño gana el enojo, nunca la tristeza
  const p = probEmocion && performance.now() - probEmocion.t < 800 ? probEmocion : null;
  if (p) {
    op.triste = Math.max(op.triste, (p.tristeza - 0.1) * 1.1 * (1 - ceno) * (1 - sonrisa));
    op.enojo = Math.max(op.enojo, (p.enojo + p.asco * 0.5 - 0.1) * 1.1 * (1 - sonrisa));
    op.sorpresa = Math.max(op.sorpresa, (p.sorpresa - 0.15) * Math.max(cejas, boca));
  }
  const [gana, val] = Object.entries(op).reduce((a, b) => (b[1] > a[1] ? b : a));
  const r = { feliz: 0, enojo: 0, triste: 0, sorpresa: 0, entorna: em.entorna, cejaTriste: 0 };
  if (val > 0.45) r[gana] = Math.min(1, (val - 0.3) / 0.5);
  r.cejaTriste = r.triste;
  return r;
}
let ojosCerrados = 0;
const historiaOjos = {};
const caraSuave = { feliz: 0, enojo: 0, triste: 0, sorpresa: 0, entorna: 0, cejaTriste: 0 };
function ponerEmocion(em) {
  for (const k in caraSuave) caraSuave[k] += ((em ? em[k] : 0) - caraSuave[k]) * (em ? 0.35 : 0.08);
  const { feliz, enojo, triste, sorpresa, entorna, cejaTriste } = caraSuave;
  window.__emocion = caraSuave;
  if (formasSueltas) {
    // La cara alegre del baile no debe quedar puesta al copiar la cámara
    gesto('happy', 0); gesto('angry', 0); gesto('sad', 0); gesto('surprised', 0);
    const abierto = 1 - ojosCerrados;
    gesto('cejaEnojo', enojo); gesto('ojoEnojo', enojo * 0.6 * abierto); gesto('bocaEnojo', enojo * 0.7);
    gesto('cejaTriste', cejaTriste); gesto('ojoTriste', triste * 0.7 * abierto); gesto('bocaTriste', triste * 0.8);
    gesto('cejaFeliz', feliz * 0.6); gesto('ojoFeliz', Math.min(feliz, entorna) * 0.7 * abierto); gesto('bocaFeliz', feliz);
    gesto('cejaSorpresa', sorpresa); gesto('ojoSorpresa', sorpresa * 0.8 * abierto); gesto('bocaSorpresa', sorpresa * 0.3);
  } else {
    gesto('happy', feliz * 0.7); gesto('angry', enojo * 0.8); gesto('sad', triste * 0.8); gesto('surprised', sorpresa * 0.7);
  }
}
// Cara del personaje en reposo: su tamaño real sale de la malla de la piel de la cara.
// Si el modelo no la tiene, se estima con la distancia entre los ojos
let caraAvatar = null;
function medirCaraAvatar() {
  const v = v3(), caja = new THREE.Box3();
  vrm.scene.updateMatrixWorld(true);
  vrm.scene.traverse(o => {
    if (!o.isSkinnedMesh || !/face.*skin/i.test([].concat(o.material).map(m => m.name).join(' '))) return;
    o.skeleton.update();
    for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); caja.expandByPoint(v); }
  });
  const cab = hueso('head'), ojos = ojosAvatar();
  const hayPiel = !caja.isEmpty();
  const mitadAncho = hayPiel ? (caja.max.x - caja.min.x) / 2 : medidas.ojoDist * 1.3;
  const mitadAlto = hayPiel ? (caja.max.y - caja.min.y) / 2 : medidas.ojoDist * 1.8;
  const centro = hayPiel ? new THREE.Vector3((caja.max.x + caja.min.x) / 2, (caja.max.y + caja.min.y) / 2, caja.max.z - mitadAncho * 0.95) : ojos.clone().add(new THREE.Vector3(0, -mitadAlto * 0.2, -mitadAncho * 0.5));
  caraAvatar = { centro, mitadAncho, mitadAlto, cabPos: cab.getWorldPosition(v3()), cabInv: cab.getWorldQuaternion(q4()).invert() };
}
// Dónde está ahora la cara del personaje (se mueve con su cabeza)
function caraAhora() {
  const cab = hueso('head'), R = cab.getWorldQuaternion(q4()).multiply(caraAvatar.cabInv);
  return { C: caraAvatar.centro.clone().sub(caraAvatar.cabPos).applyQuaternion(R).add(cab.getWorldPosition(v3())),
    U: new THREE.Vector3(-1, 0, 0).applyQuaternion(R), V: new THREE.Vector3(0, -1, 0).applyQuaternion(R), F: new THREE.Vector3(0, 0, 1).applyQuaternion(R) };
}
// Tu cara en la imagen: centro, ejes y tamaño, sacados de frente (10), mentón (152) y mejillas (234, 454)
let marcoRecordado = null;
function marcoDeCara(cara, vw, vh, t) {
  const [fr, me, mi, md] = filtrar('marcoCara', [10, 152, 234, 454].map(i => new THREE.Vector3(cara[i].x * vw, cara[i].y * vh, 0)), t, 2, 0.02);
  const c = fr.clone().add(me).multiplyScalar(0.5), eU = md.clone().sub(mi), eV = me.clone().sub(fr);
  const mitadAncho = eU.length() / 2, mitadAlto = eV.length() / 2; eU.normalize(); eV.normalize();
  return { c, eU, eV, mitadAncho, mitadAlto };
}
const enMarco = (m, x, y) => { const r = new THREE.Vector3(x - m.c.x, y - m.c.y, 0); return { u: r.dot(m.eU) / m.mitadAncho, v: r.dot(m.eV) / m.mitadAlto }; };
// Puntos de tu mano que pueden tocar la cara (5 puntas + palma), en el mismo orden que puntasYPalma
const ANCLAS_MANO = [4, 8, 12, 16, 20, 9];
// Dónde tiene que quedar la muñeca para que su mano caiga en el mismo lugar de su cara que la tuya.
// Devuelve también qué tan cerca está (1 = en la cara, 0 = lejos)
function manoEnSuCara(lado, H, marco) {
  const puntas = puntasYPalma(lado); if (puntas.length !== ANCLAS_MANO.length || !caraAvatar) return null;
  const { C, U, V, F } = caraAhora(), muneca = hueso(lado + 'Hand').getWorldPosition(v3());
  const palma = Math.hypot(H[0].x - H[9].x, H[0].y - H[9].y), proporcion = palma / (2 * marco.mitadAlto);
  // una mano que se ve muy grande junto a tu cara está más cerca de la cámara: no la toca, pasa por delante
  const delante = Math.max(0, Math.min(1, (proporcion - 0.75) / 0.6)) * 0.14;
  const suma = v3(); let pesos = 0, dMin = Infinity;
  ANCLAS_MANO.forEach((a, i) => {
    const { u, v } = enMarco(marco, -H[a].x, -H[a].y), d = Math.hypot(u, v) / 1.25; dMin = Math.min(dMin, d);
    const hondo = caraAvatar.mitadAncho * 0.95 * Math.sqrt(Math.max(0.15, 1 - 0.7 * (u * u + v * v))) + 0.015 + delante;
    const lugar = C.clone().add(U.clone().multiplyScalar(u * caraAvatar.mitadAncho)).add(V.clone().multiplyScalar(v * caraAvatar.mitadAlto)).add(F.clone().multiplyScalar(hondo));
    const peso = 1 / Math.pow(0.2 + d, 2);
    suma.add(lugar.sub(puntas[i].clone().sub(muneca)).multiplyScalar(peso)); pesos += peso;
  });
  return { destino: suma.divideScalar(pesos), cerca: dMin < 1 ? 1 : dMin > 1.5 ? 0 : (1.5 - dMin) / 0.5, dMin };
}
// Para las pruebas: qué tan lejos cae su mano del mismo lugar de la cara (en % del tamaño de la cara)
function medirManoEnCara(marco) {
  if (!window.__medir || !marco || !caraAvatar) return;
  const m = window.__seg = window.__seg || {}, { C, U, V } = caraAhora();
  for (const lado of ['left', 'right']) {
    const M = manosF[lado], lm = manos[lado === 'left' ? 'Left' : 'Right']; if (!M || !lm) continue;
    const puntas = puntasYPalma(lado); let mejor = null;
    ANCLAS_MANO.forEach((a, i) => { const q = enMarco(marco, -M.H[a].x, -M.H[a].y), d = Math.hypot(q.u, q.v); if (!mejor || d < mejor.d) mejor = { d, q, i }; });
    if (!mejor || mejor.d > 1.25) continue;
    const r = puntas[mejor.i].clone().sub(C), u = r.dot(U) / caraAvatar.mitadAncho, v = r.dot(V) / caraAvatar.mitadAlto;
    (m['manoEnCara%'] = m['manoEnCara%'] || []).push(50 * Math.hypot(mejor.q.u - u, mejor.q.v - v));
  }
}
// Centro de los ojos del personaje (si el modelo no tiene ojos, un poco delante de la cabeza)
function ojosAvatar() {
  const a = hueso('leftEye'), b = hueso('rightEye');
  if (a && b) return a.getWorldPosition(v3()).add(b.getWorldPosition(v3())).multiplyScalar(0.5);
  return hueso('head').getWorldPosition(v3()).add(new THREE.Vector3(0, 0.06, 0.06));
}
// Acomoda hombro y codo para que la muñeca llegue a «destino»; el codo se dobla hacia «codoHacia»
const bisagras = {};
function alcanzar(lado, destino, codoHacia) {
  const S = hueso(lado + 'UpperArm').getWorldPosition(v3());
  const a = medidas[lado + 'Brazo'], b = medidas[lado + 'Antebrazo'];
  const hacia = v3().subVectors(destino, S);
  // el codo de una persona no se cierra más de unos 35°: así el antebrazo nunca queda pegado al brazo
  const dMin = PRUEBA.has('e') ? Math.abs(a - b) + 0.01 : Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(35 * Math.PI / 180));
  const d = Math.max(dMin, Math.min(a + b - 0.001, hacia.length()));
  const u = hacia.normalize();
  const polo = codoHacia.clone().sub(u.clone().multiplyScalar(codoHacia.dot(u)));
  if (polo.lengthSq() < 1e-6) polo.set(lado === 'left' ? 0.4 : -0.4, -1, -0.3);
  polo.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // Eje de la bisagra del codo. Con el brazo casi estirado ese eje es dudoso: se sigue el de antes.
  // Además gira como mucho 20° por cuadro: un error de la cámara no voltea el brazo de golpe
  let bisagra = v3().crossVectors(polo, u).normalize();
  const antes = bisagras[lado];
  if (antes) {
    if (sinA < 0.35 && bisagra.dot(antes) < 0) bisagra.negate();
    bisagra = antes.clone().lerp(bisagra, Math.min(1, 0.15 + sinA * 2)).normalize();
    const ang = antes.angleTo(bisagra), tope = 20 * Math.PI / 180;
    if (ang > tope && !PRUEBA.has('b')) {
      const eje = v3().crossVectors(antes, bisagra);
      if (eje.lengthSq() < 1e-8) eje.copy(u);
      bisagra = antes.clone().applyAxisAngle(eje.normalize(), tope);
    }
  }
  // queda perpendicular a la línea hombro-muñeca, y el codo se ubica con este eje ya suavizado
  bisagra.sub(u.clone().multiplyScalar(bisagra.dot(u)));
  if (bisagra.lengthSq() < 1e-8) bisagra.crossVectors(polo, u);
  bisagra.normalize();
  bisagras[lado] = bisagra;
  polo.crossVectors(u, bisagra).normalize();
  const E = S.clone().add(u.clone().multiplyScalar(a * cosA)).add(polo.multiplyScalar(a * sinA));
  const T = S.clone().add(u.clone().multiplyScalar(d));
  // Brazo y antebrazo apuntan exacto a donde van, y su giro sobre sí mismos sale de la bisagra:
  // no depende de cuadros anteriores, así no se tuerce de golpe con la mano en la cara
  const b0 = reposoDir[lado + 'Bisagra'];
  ponerGiroMundo(lado + 'UpperArm', giroDeBase(reposoDir[lado + 'UpperArm'], b0, v3().subVectors(E, S), bisagra), 1);
  ponerGiroMundo(lado + 'LowerArm', giroDeBase(reposoDir[lado + 'LowerArm'], b0, v3().subVectors(T, E), bisagra), 1);
}
// Mide qué tan parecido quedó (para las pruebas): ángulo de brazo y antebrazo en grados y,
// con la mano en la cara, la distancia al lugar correcto en «distancias entre ojos»
const medida = { n: 0, angulo: 0, nCara: 0, cara: 0 };
window.__medida = medida;
// Para las pruebas: compara en pantalla cada parte del cuerpo de ella con la tuya en la imagen
// (ángulo de cada segmento en grados). Solo cuenta partes que se ven claro
const SEGMENTOS = { hombros: [12, 11, 'leftUpperArm', 'rightUpperArm'], torso: [-1, -2, 'hips', 'neck'],
  brazoI: [12, 14, 'leftUpperArm', 'leftLowerArm'], antebrazoI: [14, 16, 'leftLowerArm', 'leftHand'],
  brazoD: [11, 13, 'rightUpperArm', 'rightLowerArm'], antebrazoD: [13, 15, 'rightLowerArm', 'rightHand'],
  musloI: [24, 26, 'leftUpperLeg', 'leftLowerLeg'], canillaI: [26, 28, 'leftLowerLeg', 'leftFoot'],
  musloD: [23, 25, 'rightUpperLeg', 'rightLowerLeg'], canillaD: [25, 27, 'rightLowerLeg', 'rightFoot'] };
function medirTodo(P) {
  if (!P || !window.__medir) return;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const ok = i => i < 0 || ((P[i].visibility ?? 1) > 0.7 && P[i].x > 0 && P[i].x < 1 && P[i].y > 0 && P[i].y < 1);
  const img = i => i === -1 ? { x: (P[23].x + P[24].x) / 2, y: (P[23].y + P[24].y) / 2 } : i === -2 ? { x: (P[11].x + P[12].x) / 2, y: (P[11].y + P[12].y) / 2 } : P[i];
  const pant = n => { const v = hueso(n).getWorldPosition(v3()).project(camara); return v; };
  const dif = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180 / Math.PI;
  const m = window.__seg = window.__seg || {};
  (m['manos vistas %'] = m['manos vistas %'] || []).push(visto.manos * 50);
  // dónde queda cada muñeca respecto de los hombros, en % del ancho de hombros
  if (ok(11) && ok(12)) {
    const hI = pant('leftUpperArm'), hD = pant('rightUpperArm'), anchoAv = Math.hypot(hD.x - hI.x, (hD.y - hI.y) / camara.aspect);
    const anchoImg = Math.hypot((P[11].x - P[12].x) * vw, (P[11].y - P[12].y) * vh);
    const cx = (P[11].x + P[12].x) / 2, cy = (P[11].y + P[12].y) / 2, ax = (hI.x + hD.x) / 2, ay = (hI.y + hD.y) / 2;
    for (const [lado, i] of [['left', 16], ['right', 15]]) {
      const lm = manos[lado === 'left' ? 'Left' : 'Right'], w = lm ? lm[0] : (ok(i) ? P[i] : null); if (!w) continue;
      const ix = -(w.x - cx) * vw / anchoImg, iy = -(w.y - cy) * vh / anchoImg;
      const mp = pant(lado + 'Hand'), mx = (mp.x - ax) / anchoAv, my = (mp.y - ay) / camara.aspect / anchoAv;
      (m['mano' + (lado === 'left' ? 'I' : 'D') + '%'] = m['mano' + (lado === 'left' ? 'I' : 'D') + '%'] || []).push(100 * Math.hypot(ix - mx, iy - my));
    }
  }
  for (const [k, [a, b, ha, hb]] of Object.entries(SEGMENTOS)) {
    if (!ok(a) || !ok(b) || (a < 0 && !(ok(23) && ok(24) && ok(11) && ok(12)))) continue;
    const A = img(a), B = img(b);
    const angImg = Math.atan2(-(B.y - A.y) * vh, -(B.x - A.x) * vw);    // espejo, como se ve en pantalla
    const pa = pant(ha), pb = pant(hb);
    const angAv = Math.atan2((pb.y - pa.y) / camara.aspect, pb.x - pa.x);
    // una parte que apunta a la cámara se ve muy corta y su ángulo no dice nada: no se cuenta
    const largoImg = Math.hypot((B.x - A.x) * vw, (B.y - A.y) * vh), largo3D = hueso(ha).getWorldPosition(v3()).distanceTo(hueso(hb).getWorldPosition(v3()));
    const largoAv = Math.hypot(pb.x - pa.x, (pb.y - pa.y) / camara.aspect) / Math.max(1e-6, largo3D);
    (m.escala = m.escala || []).push(largoImg / Math.max(1e-6, largo3D));
    if (largoAv < 0.35 * (m.refAv = Math.max(m.refAv || 0, largoAv)) ) continue;
    (m[k] = m[k] || []).push(dif(angImg, angAv));
  }
}
function medir(lado, munecaImg, ojosImg, ojoDistImg, cerca, P) {
  if (!P) return;
  const [hombro, codo, muneca] = lado === 'left' ? [12, 14, 16] : [11, 13, 15];
  const ve = i => (P[i].visibility ?? 1) > 0.5;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const pos = n => hueso(n).getWorldPosition(v3());
  const dif = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180 / Math.PI;
  const S = pos(lado + 'UpperArm'), E = pos(lado + 'LowerArm'), H = pos(lado + 'Hand');
  if (cerca < 0.5 && ve(hombro) && ve(codo) && ve(muneca)) {
    const p2 = (x, y) => Math.atan2(-(P[y].y - P[x].y) * vh, -(P[y].x - P[x].x) * vw);
    const e = (dif(p2(hombro, codo), Math.atan2(E.y - S.y, E.x - S.x)) + dif(p2(codo, muneca), Math.atan2(H.y - E.y, H.x - E.x))) / 2;
    medida.n++; medida.angulo += e;
  } else if (cerca >= 0.99 && ojosImg && munecaImg) {
    const O = ojosAvatar();
    const rx = (munecaImg.x - ojosImg.x) / ojoDistImg, ry = (munecaImg.y - ojosImg.y) / ojoDistImg;
    const ax = -(H.x - O.x) / medidas.ojoDist, ay = -(H.y - O.y) / medidas.ojoDist;
    medida.nCara++; medida.cara += Math.hypot(rx - ax, ry - ay);
  }
}

// Superficie del cuerpo: al cargar se leen los puntos de la malla y se guarda, para cada parte
// (cabeza, pecho, panza, cadera, piernas), dónde está su frente y su espalda. Cada parte se mueve
// con su hueso. Si una mano o un dedo queda adentro, la mano se saca hasta apoyarse en la piel.
const CELDA = 0.012;
const PARTES = { head: 'head', neck: 'head', leftEye: 'head', rightEye: 'head', jaw: 'head',
  upperChest: 'chest', chest: 'chest', spine: 'spine', hips: 'hips',
  leftUpperLeg: 'leftUpperLeg', rightUpperLeg: 'rightUpperLeg', leftLowerLeg: 'leftLowerLeg', rightLowerLeg: 'rightLowerLeg' };
let superficie = null;
function medirSuperficie() {
  vrm.humanoid.update(); vrm.scene.updateMatrixWorld(true);
  // hueso de la malla → parte del cuerpo (los huesos del pelo y la ropa toman la parte de su padre)
  const parteDe = new Map();
  for (const [n, parte] of Object.entries(PARTES)) { const r = vrm.humanoid.getRawBoneNode(n); if (r) parteDe.set(r, parte); }
  const buscar = b => { let x = b; while (x) { if (parteDe.has(x)) return parteDe.get(x); if (/arm|hand|shoulder|thumb|index|middle|ring|little/i.test(x.name)) return null; x = x.parent; } return null; };
  const puntos = {}; const v = v3();
  vrm.scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const idx = o.geometry.attributes.skinIndex, peso = o.geometry.attributes.skinWeight, n = o.geometry.attributes.position.count;
    const cache = new Map();
    for (let i = 0; i < n; i += 2) {                               // la mitad de los puntos alcanza
      let mejor = 0, hb = 0;
      for (let k = 0; k < 4; k++) { const w = peso.getComponent(i, k); if (w > mejor) { mejor = w; hb = idx.getComponent(i, k); } }
      const b = o.skeleton.bones[hb]; if (!cache.has(b)) cache.set(b, buscar(b));
      const parte = cache.get(b); if (!parte) continue;
      o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld);
      (puntos[parte] = puntos[parte] || []).push(v.x, v.y, v.z);
    }
  });
  superficie = [];
  for (const [parte, p] of Object.entries(puntos)) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    const nx = Math.ceil((x1 - x0) / CELDA) + 1, ny = Math.ceil((y1 - y0) / CELDA) + 1;
    const frente = new Float32Array(nx * ny).fill(-Infinity), atras = new Float32Array(nx * ny).fill(Infinity);
    for (let i = 0; i < p.length; i += 3) {
      const c = Math.round((p[i + 1] - y0) / CELDA) * nx + Math.round((p[i] - x0) / CELDA);
      frente[c] = Math.max(frente[c], p[i + 2]); atras[c] = Math.min(atras[c], p[i + 2]);
    }
    const h = hueso(parte);
    superficie.push({ parte, x0, y0, nx, ny, frente, atras, reposo: h.matrixWorld.clone(), q0: h.getWorldQuaternion(q4()),
      ahoraInv: new THREE.Matrix4(), adelante: v3() });
  }
}
// Una vez por cuadro: dónde está cada parte ahora
function actualizarSuperficie() {
  if (!superficie) return;
  const q = q4();
  for (const S of superficie) {
    const h = hueso(S.parte);
    S.ahoraInv.copy(h.matrixWorld).invert().premultiply(S.reposo);   // punto de ahora → punto en reposo
    S.adelante.set(0, 0, 1).applyQuaternion(S.q0.clone().invert()).applyQuaternion(h.getWorldQuaternion(q));
  }
}
// Cuánto está metido un punto dentro del cuerpo y hacia dónde sacarlo
const enReposo = v3();
function hundido(p) {
  let max = 0, dir = null;
  if (!superficie) return { max, dir };
  for (const S of superficie) {
    enReposo.copy(p).applyMatrix4(S.ahoraInv);
    const i = Math.round((enReposo.x - S.x0) / CELDA), j = Math.round((enReposo.y - S.y0) / CELDA);
    if (i < 0 || j < 0 || i >= S.nx || j >= S.ny) continue;
    const c = j * S.nx + i, f = S.frente[c], a = S.atras[c];
    if (f === -Infinity) continue;
    const borde = f + 0.012;
    if (enReposo.z < borde && enReposo.z > a - 0.005 && borde - enReposo.z > max) { max = borde - enReposo.z; dir = S.adelante; }
  }
  return { max, dir };
}
const PUNTAS = ['Hand', 'IndexIntermediate', 'IndexDistal', 'MiddleIntermediate', 'MiddleDistal', 'RingDistal', 'LittleDistal', 'ThumbProximal', 'ThumbDistal'];
// Puntos a lo largo del antebrazo y del brazo (codo incluido)
function puntosBrazo(lado) {
  const h = n => hueso(lado + n), S = h('UpperArm'), E = h('LowerArm'), M = h('Hand');
  if (!S || !E || !M) return [];
  const s = S.getWorldPosition(v3()), e = E.getWorldPosition(v3()), m = M.getWorldPosition(v3()), r = [];
  // el brazo de arriba roza el costado sin problema: solo se revisan el antebrazo y el codo
  r.push(e.clone());
  for (const f of [0.25, 0.5, 0.75]) r.push(e.clone().lerp(m, f));
  return r;
}
const peorBrazo = lado => {
  let r = { max: 0, dir: null };
  for (const p of puntosBrazo(lado)) { const x = hundido(p); if (x.max > r.max) r = x; }
  r.max = Math.max(0, r.max - 0.01);     // 1 cm de margen: la piel del brazo se puede apoyar
  return r;
};
const peor = lado => {
  let r = { max: 0, dir: null };
  for (const n of PUNTAS) { const h = hueso(lado + n); if (!h) continue; const x = hundido(h.getWorldPosition(v3())); if (x.max > r.max) r = x; }
  for (const p of puntasYPalma(lado)) { const x = hundido(p); if (x.max > r.max) r = x; }
  return r;
};
// Las puntas de los dedos (un poco más allá del último hueso) y el centro de la palma
function puntasYPalma(lado) {
  const pos = n => { const h = hueso(lado + n); return h ? h.getWorldPosition(v3()) : null; }, r = [];
  for (const d of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const a = pos(d + (d === 'Thumb' ? 'Proximal' : 'Intermediate')), b = pos(d + 'Distal');
    if (a && b) r.push(b.clone().add(b.clone().sub(a).multiplyScalar(0.8)));
  }
  const m = pos('Hand'), c = pos('MiddleProximal'); if (m && c) r.push(m.lerp(c, 0.5));
  return r;
}
// Corre la muñeca un poco y vuelve a acomodar el brazo; la mano queda girada igual que antes
function correrMano(lado, cuanto) {
  const mano = hueso(lado + 'Hand'); if (!mano || !destinos[lado]) return;
  const giroMano = mano.getWorldQuaternion(q4());
  destinos[lado].add(cuanto);
  alcanzar(lado, destinos[lado], codosHacia[lado] || new THREE.Vector3(lado === 'left' ? 0.4 : -0.4, -1, -0.3));
  mano.quaternion.copy(mano.parent.getWorldQuaternion(q4()).invert().multiply(giroMano));
  mano.updateWorldMatrix(false, true);
}
// Hacia dónde sacar un punto del cuerpo: hacia la cámara (así en pantalla la pose se ve igual a la tuya);
// solo si el cuerpo está de espaldas a la cámara se usa el frente del cuerpo
function haciaAfuera(punto, frente, cuanto) {
  const aCam = camara.position.clone().sub(punto).normalize(), c = frente.dot(aCam);
  return c > 0.3 ? aCam.multiplyScalar(cuanto / c) : frente.clone().multiplyScalar(cuanto);
}
function sacarDelCuerpo(lado) {
  if (!destinos[lado] || !superficie || PRUEBA.has('c')) return;
  for (let vuelta = 0; vuelta < 8; vuelta++) {
    const mano = PRUEBA.has('h') ? { max: 0 } : peor(lado), brazo = PRUEBA.has('g') ? { max: 0 } : peorBrazo(lado);
    if (mano.max <= 0.001 && brazo.max <= 0.001) return;
    medida.empujes = (medida.empujes || 0) + 1;
    const muneca = hueso(lado + 'Hand').getWorldPosition(v3());
    if (mano.max >= brazo.max) { correrMano(lado, haciaAfuera(muneca, mano.dir, mano.max * 1.3 + 0.004)); continue; }
    // El antebrazo o el codo entran: el codo sale hacia afuera y la muñeca acompaña un poco
    const fuera = haciaAfuera(hueso(lado + 'LowerArm').getWorldPosition(v3()), brazo.dir, 1).normalize();
    const codo = (codosHacia[lado] || new THREE.Vector3(lado === 'left' ? 0.4 : -0.4, -1, -0.3)).clone().normalize();
    codosHacia[lado] = codo.add(fuera.clone().multiplyScalar(1.5));
    correrMano(lado, haciaAfuera(muneca, brazo.dir, brazo.max * 0.7 + 0.003));
  }
}
// Las dos manos se tocan pero no se meten una dentro de la otra
const puntasDe = l => PUNTAS.map(n => hueso(l + n)).filter(Boolean).map(h => h.getWorldPosition(v3())).concat(puntasYPalma(l));
const HUECO_MANOS = 0.018;
function distanciaManos() {
  const A = puntasDe('left'), B = puntasDe('right'); let min = Infinity;
  for (const a of A) for (const b of B) min = Math.min(min, a.distanceTo(b));
  return { min, A, B };
}
function separarManos() {
  if (!destinos.left || !destinos.right) return;
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const { min, A, B } = distanciaManos();
    if (min >= HUECO_MANOS) return;
    const dir = A[0].clone().sub(B[0]); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize().multiplyScalar((HUECO_MANOS - min) / 2 + 0.002);
    correrMano('left', dir); correrMano('right', dir.clone().negate());
  }
}
// Cuántos cuadros quedan con la mano adentro del cuerpo (para las pruebas)
const giroAntes = {};
function contarDentro() {
  if (destinos.left && destinos.right && distanciaManos().min < HUECO_MANOS * 0.5) medida.manosJuntas = (medida.manosJuntas || 0) + 1;
  for (const l of ['left', 'right']) {
    const g = hueso(l + 'Hand').getWorldQuaternion(q4());
    if (giroAntes[l]) { const d = giroAntes[l].angleTo(g) * 180 / Math.PI; medida.giro = (medida.giro || 0) + d; medida.nGiro = (medida.nGiro || 0) + 1; (medida.giros = medida.giros || []).push(d); }
    giroAntes[l] = g;
    medida.cuadros = (medida.cuadros || 0) + 1;
    if (peor(l).max > 0.005) medida.dentro = (medida.dentro || 0) + 1;
    if (peorBrazo(l).max > 0.005) medida.brazoDentro = (medida.brazoDentro || 0) + 1;
  }
}
// La muñeca de una persona gira hasta unos 90° sobre sí misma y se dobla hasta unos 80°:
// si la cámara pide más (pasa con las manos juntas), se deja en el límite y no se deforma
// Dedos como los de una mano real: se doblan hacia la palma, casi nada hacia atrás ni de costado, y sin torcerse.
// Los huesos normalizados en reposo no tienen giro y la palma mira hacia abajo, así que cada giro se separa en
// doblar (hacia la palma), abrir (de costado) y torcer (sobre el dedo), y cada parte tiene su tope.
const LIM_DEDO = { // [doblar mín, doblar máx, abrir, torcer] en grados
  Proximal: [-12, 95, 22, 12], Intermediate: [-5, 110, 6, 6], Distal: [-8, 85, 6, 6],
  ThumbMetacarpal: [-25, 55, 40, 30], ThumbProximal: [-15, 65, 18, 20], ThumbDistal: [-15, 80, 10, 12] };
const ejesDedo = {};
function limitarDedos(lado) {
  let corregidos = 0;
  for (const [d, partes] of Object.entries(DEDOS)) partes.forEach((parte, k) => {
    const n = lado + d + parte, h = hueso(n); if (!h) return;
    let e = ejesDedo[n];
    if (!e) {
      // dirección del dedo en reposo: hacia el siguiente hueso (o la misma que el anterior en la punta)
      const sig = partes[k + 1] ? hueso(lado + d + partes[k + 1]) : null;
      const r = (sig ? sig.position.clone() : h.position.clone()).normalize();
      const palma = new THREE.Vector3(0, -1, 0), a = v3().crossVectors(r, palma);
      if (a.lengthSq() < 1e-6) return;
      a.normalize();
      e = ejesDedo[n] = { r, doblar: a, abrir: v3().crossVectors(a, r).normalize(), lim: LIM_DEDO[d === 'Thumb' ? 'Thumb' + parte : parte].map(x => x * Math.PI / 180) };
    }
    const q = h.quaternion;
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);   // mismo giro, forma corta
    // separar: torsión sobre el dedo + el resto (inclinación)
    const pr = new THREE.Vector3(q.x, q.y, q.z).projectOnVector(e.r), tor = new THREE.Quaternion(pr.x, pr.y, pr.z, q.w).normalize();
    const incl = q.clone().multiply(tor.clone().invert());
    const angulo = 2 * Math.acos(Math.min(1, Math.abs(incl.w))), s = Math.sqrt(1 - Math.min(1, incl.w * incl.w));
    const vec = s > 1e-6 ? new THREE.Vector3(incl.x, incl.y, incl.z).multiplyScalar((incl.w < 0 ? -1 : 1) * angulo / s) : v3();
    let dob = vec.dot(e.doblar), abr = vec.dot(e.abrir);
    const ta = 2 * Math.atan2(new THREE.Vector3(tor.x, tor.y, tor.z).dot(e.r), tor.w);
    const [mn, mx, ab, to] = e.lim;
    const dob2 = Math.max(mn, Math.min(mx, dob)), abr2 = Math.max(-ab, Math.min(ab, abr)), ta2 = Math.max(-to, Math.min(to, ta));
    if (Math.abs(dob2 - dob) + Math.abs(abr2 - abr) + Math.abs(ta2 - ta) < 0.02) return;
    corregidos++;
    if (PRUEBA.has('sinlimdedos')) return;   // las pruebas miden el antes sin corregir
    const nuevo = v3().addScaledVector(e.doblar, dob2).addScaledVector(e.abrir, abr2), ang = nuevo.length();
    const qi = ang > 1e-6 ? q4().setFromAxisAngle(nuevo.normalize(), ang) : q4();
    q.copy(qi.multiply(q4().setFromAxisAngle(e.r, ta2)));
  });
  return corregidos;
}
function limitarMuneca(lado) {
  const h = hueso(lado + 'Hand'), ante = hueso(lado + 'LowerArm'), d0 = reposoDir[lado + 'LowerArm']; if (!h || !ante || !d0) return;
  const eje = d0.clone().applyQuaternion(rotEscena.clone().invert()).normalize();
  const qm = h.quaternion;
  // separa el giro de la mano en: giro sobre el antebrazo + doblar la muñeca
  const partes = () => {
    const pr = new THREE.Vector3(qm.x, qm.y, qm.z).projectOnVector(eje);
    const giro = new THREE.Quaternion(pr.x, pr.y, pr.z, qm.w).normalize();
    return { giro, doblez: qm.clone().multiply(giro.clone().invert()) };
  };
  // Como en una persona: la mitad del giro la hace el antebrazo (la mano queda igual en el mundo)
  const mitad = new THREE.Quaternion().slerp(partes().giro, 0.5);
  ante.quaternion.multiply(mitad); qm.premultiply(mitad.clone().invert());
  const { giro, doblez } = partes();
  const ang = q => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  (medida.angG = medida.angG || []).push(ang(giro) * 57.3); (medida.angD = medida.angD || []).push(ang(doblez) * 57.3);
  const tope = (q, max) => { const a = ang(q); if (a > max) { q.slerp(new THREE.Quaternion(), 1 - max / a); return true; } return false; };
  const t1 = tope(giro, 85 * Math.PI / 180), t2 = tope(doblez, 80 * Math.PI / 180);
  if (t1 || t2) { medida.munecaTope = (medida.munecaTope || 0) + 1; qm.copy(doblez.multiply(giro)); }
  ante.updateWorldMatrix(false, true);
}
const codosHacia = {}, tiempoDestino = {};
let caraVista = -1e9;
let usarRecorte = false, fallosRecorte = 0, fallosEntera = 0;
const lienzoCara = document.createElement('canvas'); lienzoCara.width = lienzoCara.height = 320;

let horaCara = 0;
const dtCara = ahora => { const d = Math.min(0.1, Math.max(0, (ahora - horaCara) / 1000)); horaCara = ahora; return d; };
function seguir(ahora) {
  if (!detectores || video.readyState < 2) return;
  if (video.currentTime !== ultimoVideo) {
    ultimoVideo = video.currentTime;
    const t = ahora;
    // al empezar o si te perdió, busca hasta dos personas para elegir; ya elegida, busca una sola (más rápido y sigue esa zona)
    const buscarDos = !persona || t - persona.t > 1500 || t - persona.desde < 2000;
    if (buscarDos !== poseDos) { poseDos = buscarDos; detectores.pose.setOptions({ numPoses: buscarDos ? 2 : 1 }).catch?.(() => {}); }
    const rp = detectores.pose.detectForVideo(video, t);
    // Si hay dos personas se elige: la que ya seguía (la más cercana a donde estaba) o, al empezar, la más cerca de la cámara (la más grande)
    const centro = l => [(l[11].x + l[12].x + l[23].x + l[24].x) / 4, (l[11].y + l[12].y + l[23].y + l[24].y) / 4];
    const tam = l => Math.hypot(l[11].x - l[12].x, l[11].y - l[12].y) + Math.hypot(l[11].x - l[23].x, l[11].y - l[23].y);
    let elegida = 0;
    if (rp.landmarks && rp.landmarks.length > 1) {
      const sigue = persona && t - persona.t < 1500;
      const puntaje = l => sigue ? -Math.hypot(centro(l)[0] - persona.x, centro(l)[1] - persona.y) : tam(l);
      elegida = puntaje(rp.landmarks[1]) > puntaje(rp.landmarks[0]) ? 1 : 0;
    }
    ultimaPose = rp.landmarks && rp.landmarks[elegida] ? { l: rp.landmarks[elegida], w: rp.worldLandmarks[elegida] } : null;
    // Una sola persona: si el cuerpo aparece de golpe en otro lado (otra persona entró), se ignora;
    // solo se cambia de persona si la tuya no se ve por más de 1,5 s
    if (ultimaPose) {
      const l = ultimaPose.l, cx = (l[11].x + l[12].x + l[23].x + l[24].x) / 4, cy = (l[11].y + l[12].y + l[23].y + l[24].y) / 4;
      const salto = persona ? Math.hypot(cx - persona.x, cy - persona.y) : 0, ancho = Math.abs(l[11].x - l[12].x) || 0.1;
      if (persona && salto > Math.max(0.18, ancho * 1.6) && t - persona.t < 1500 && !PRUEBA.has('sinbloqueo')) ultimaPose = null;
      else persona = { x: cx, y: cy, t, desde: persona && t - persona.t < 1500 ? persona.desde : t };
      if (PRUEBA.has('medirpersona')) (window.__personaX = window.__personaX || []).push(ultimaPose ? +cx.toFixed(2) : -1);
    }
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    cuerpoF = ultimaPose ? filtrar('cuerpo', poseIgualImagen(ultimaPose.l, ultimaPose.w, vw, vh), t, 1.2, 0.012) : null;
    // Cada mano se asigna por cercanía a tu muñeca (más seguro que el «izquierda/derecha» del detector)
    const rm = detectores.manos.detectForVideo(video, t);
    manos = { Left: null, Right: null };
    // Cada mano se reconoce juntando 3 pistas: a qué muñeca del cuerpo está más cerca, dónde estaba
    // cada mano un momento antes y si el detector la ve izquierda o derecha. Con las manos juntas
    // así no se cambian de lado (antes saltaban).
    const lados = ['left', 'right'], munecaPose = { left: 16, right: 15 };
    const costo = (i, lado) => {
      const lm = rm.landmarks[i], w = lm[0]; let c = 0;
      if (ultimaPose && (ultimaPose.l[munecaPose[lado]].visibility ?? 1) > 0.3) { const q = ultimaPose.l[munecaPose[lado]]; c += Math.hypot(q.x - w.x, q.y - w.y); }
      const antes = manoAntes[lado]; if (antes && t - antes.t < 500) c += 0.7 * Math.hypot(antes.x - w.x, antes.y - w.y);
      const h = rm.handedness[i][0]; if ((h.categoryName === 'Left' ? 'left' : 'right') !== lado) c += 0.12 * h.score;
      return c;
    };
    // Manos falsas fuera: solo vale una mano segura, cerca de una muñeca de tu cuerpo (si se ve),
    // que no esté encima de otra (la misma mano vista dos veces) y que se confirme 3 cuadros seguidos
    {
      const tam = lm => Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
      let lista = (rm.landmarks || []).map((lm, i) => ({ lm, h: rm.handedness[i], w: rm.worldLandmarks ? rm.worldLandmarks[i] : null, score: rm.handedness[i][0].score }));
      lista = lista.filter(m => {
        if (m.score < 0.5) return false;
        if (!ultimaPose) return true;
        const segura = q => (q.visibility ?? 1) > 0.65 && q.y < 0.97 && q.x > 0.01 && q.x < 0.99;
        const cerca = [15, 16].some(k => { const q = ultimaPose.l[k]; return segura(q) && Math.hypot(q.x - m.lm[0].x, q.y - m.lm[0].y) < Math.max(0.12, 2.5 * tam(m.lm)); });
        const algunaVista = [15, 16].some(k => segura(ultimaPose.l[k]));
        return cerca || !algunaVista;
      });
      lista.sort((a, b) => b.score - a.score);
      if (lista.length === 2 && Math.hypot(lista[0].lm[0].x - lista[1].lm[0].x, lista[0].lm[0].y - lista[1].lm[0].y) < 0.6 * tam(lista[0].lm)) lista.pop();
      // confirmar: cuántos cuadros seguidos se vio una mano en ese lugar
      const vistas = lista.map(m => {
        const previa = manosVistas.find(v => Math.hypot(v.x - m.lm[0].x, v.y - m.lm[0].y) < 0.15);
        return { x: m.lm[0].x, y: m.lm[0].y, n: previa ? previa.n + 1 : 1 };
      });
      manosVistas = vistas;
      lista = lista.filter((m, i) => vistas[i].n >= 3);
      rm.landmarks = lista.map(m => m.lm); rm.handedness = lista.map(m => m.h);
    }
    const n = (rm.landmarks || []).length, asignado = [];
    if (n === 1) asignado[0] = costo(0, 'left') <= costo(0, 'right') ? 'left' : 'right';
    else if (n >= 2) {
      const recto = costo(0, 'left') + costo(1, 'right'), cruzado = costo(0, 'right') + costo(1, 'left');
      asignado[0] = recto <= cruzado ? 'left' : 'right'; asignado[1] = asignado[0] === 'left' ? 'right' : 'left';
    }
    const ponerMano = (lm, lado) => {
      manoAntes[lado] = { x: lm[0].x, y: lm[0].y, t };
      manos[lado === 'left' ? 'Left' : 'Right'] = lm;
      // La forma de la mano (dedos y giro) se suaviza aparte de su recorrido: al mover el brazo
      // rápido la mano no tiembla, y al girarla o mover los dedos responde enseguida
      const crudo = manoIgualImagen(lm, vw, vh), muneca = crudo[0].clone();
      const forma = filtrar('forma' + lado, crudo.map(p => p.clone().sub(muneca)), t, 0.9, 0.03);
      const sitio = filtrar('sitio' + lado, [muneca], t, 1.5, 0.015)[0];
      manosF[lado] = { H: forma.map(p => p.add(sitio)), t };
    };
    (rm.landmarks || []).slice(0, 2).forEach((lm, i) => ponerMano(lm, asignado[i]));
    // búsqueda extra de manos: cuesta casi como el detector entero, así que va solo en los cuadros donde no se
    // busca la cara (turno 1 aquí = la cara no corre en este cuadro), uno sí y uno no, alternando el lado
    if (ultimaPose && turno === 1 && ++turnoMano % 2 === 0) {
      const lado = turnoMano % 4 === 0 ? 'left' : 'right';
      if (!manos[lado === 'left' ? 'Left' : 'Right']) { const lm = manoEnRecorte(lado, vw, vh); if (lm) ponerMano(lm, lado); }
    }
    turno = 1 - turno;
    if (turno) {
      let rc = null, recorte = null;
      // Lejos de la cámara tu cara se ve chica y el detector no la encuentra: se amplía la zona de tu cabeza
      const pl = ultimaPose ? ultimaPose.l : null;
      if (usarRecorte && pl && (pl[0].visibility ?? 1) > 0.3) {
        const lado = Math.max(60, Math.hypot((pl[11].x - pl[12].x) * vw, (pl[11].y - pl[12].y) * vh) * 1.3);
        recorte = { x: pl[0].x * vw - lado / 2, y: pl[0].y * vh - lado / 2, lado };
        const g = lienzoCara.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 320, 320); g.drawImage(video, recorte.x, recorte.y, lado, lado, 0, 0, 320, 320);
        rc = detectores.cara.detectForVideo(lienzoCara, t);
        if (rc.faceLandmarks && rc.faceLandmarks[0]) {
          rc.faceLandmarks[0] = rc.faceLandmarks[0].map(p => ({ x: (recorte.x + p.x * lado) / vw, y: (recorte.y + p.y * lado) / vh, z: p.z * lado / vw }));
          // ya se ve grande: vuelve a la imagen entera
          if (lado > vh * 0.45) usarRecorte = false;
        } else if (++fallosRecorte > 15) { usarRecorte = false; fallosRecorte = 0; }
      } else {
        rc = detectores.cara.detectForVideo(video, t);
        if (!(rc.faceLandmarks && rc.faceLandmarks[0])) { if (++fallosEntera > 8) { usarRecorte = true; fallosEntera = 0; } } else fallosEntera = 0;
      }
      ultimaCara = rc.faceLandmarks && rc.faceLandmarks[0] ? rc.faceLandmarks[0] : null;
      // la cara tiene que ser la de tu cuerpo (no la de otra persona al lado)
      if (ultimaCara && ultimaPose) {
        const n = ultimaPose.l[0], f = ultimaCara[1], ancho = Math.abs(ultimaPose.l[11].x - ultimaPose.l[12].x) || 0.1;
        if (Math.hypot(n.x - f.x, n.y - f.y) > Math.max(0.08, ancho * 0.6)) { ultimaCara = null; rc = {}; }
      }
      caraMatriz = rc.facialTransformationMatrixes && rc.facialTransformationMatrixes[0] ? rc.facialTransformationMatrixes[0].data : null;
      caraGestos = rc.faceBlendshapes && rc.faceBlendshapes[0] ? Object.fromEntries(rc.faceBlendshapes[0].categories.map(c => [c.categoryName, c.score])) : null;
    }
  }
  visto.cuerpo = !!ultimaPose; visto.manos = (manos.Left ? 1 : 0) + (manos.Right ? 1 : 0); visto.cara = !!ultimaCara;
  dibujarPuntos();
  vrm.scene.updateMatrixWorld(true);

  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const img = p => new THREE.Vector2(p.x * vw, p.y * vh);
  const P = ultimaPose ? ultimaPose.l : null, W = cuerpoF;
  const ve = i => !!P && (P[i].visibility ?? 1) > 0.5;

  // Piernas y cadera: si se ven, copian las tuyas; si no, quedan paradas y derechas
  // (una pierna tapada por la otra se ve poco: basta con que se distinga algo y esté dentro de la imagen)
  const dentro = i => !!P && (P[i].visibility ?? 1) > 0.3 && P[i].y < 0.98;
  const hwP = ultimaPose ? ultimaPose.w : null;
  const rod = P ? medirRodillas(P, hwP, vw, vh, ahora) : null;
  const claraP = i => !!P && (P[i].visibility ?? 1) > 0.6 && P[i].y < 0.97;
  // Torso casi acostado y manos abajo con los pies tapados: en cuatro patas
  let enCuatro = false;
  if (P && ve(11) && ve(12)) {
    const hom = v3().addVectors(hwP[11], hwP[12]).multiplyScalar(0.5), cad = v3().addVectors(hwP[23], hwP[24]).multiplyScalar(0.5), t = v3().subVectors(hom, cad);
    // muy cerca de la cámara (hombros anchos o cadera fuera de la imagen) no cuenta: el detector inventa el resto
    const lejos = Math.abs(P[11].x - P[12].x) < 0.3 && P[23].y < 0.95 && P[24].y < 0.95 && (P[23].visibility ?? 1) > 0.3 && (P[24].visibility ?? 1) > 0.3;
    enCuatro = lejos && Math.abs(t.y) < 0.6 * t.length() && hwP[15].y > hom.y + 0.15 && hwP[16].y > hom.y + 0.15 && !(claraP(27) && claraP(28));
  }
  if (enCuatro) { if (!desdeCuatro) desdeCuatro = ahora; } else desdeCuatro = 0;
  cuatroPatas = !!desdeCuatro && ahora - desdeCuatro > 150;
  const conRodilla = !!rod && (rod.left.si || rod.right.si);
  giroCadera = null;
  const piernas = [23, 24, 25, 26, 27, 28].every(dentro);
  if (piernas || conRodilla || cuatroPatas) piernasVistas = ahora;
  if (conRodilla || cuatroPatas) {
    // Arrodillado o gateando: el muslo copia el tuyo y la canilla va hacia atrás, apoyada en el piso
    const arriba = v3().addVectors(W[11], W[12]).sub(v3().addVectors(W[23], W[24]));
    giroCadera = giroDeBase(reposoDir.torsoArriba, reposoDir.caderaLado, arriba, v3().subVectors(W[24], W[23]));
    ponerGiroMundo('hips', giroCadera, 0.4);
    const atras = reposoDir.frente.clone().negate(), abajo = reposoDir.torsoArriba.clone().negate();
    for (const [l, cad, r, tob] of [['left', 24, 26, 28], ['right', 23, 25, 27]]) {
      if (rod[l].si || cuatroPatas) {
        apuntar(l + 'UpperLeg', cuatroPatas ? abajo.clone().add(reposoDir.frente.clone().multiplyScalar(0.15)) : v3().subVectors(W[r], W[cad]), 0.4);
        apuntar(l + 'LowerLeg', atras.clone().add(abajo.clone().multiplyScalar(0.12)), 0.4);
        apuntar(l + 'Foot', atras.clone().add(abajo.clone().multiplyScalar(0.3)), 0.4);
      } else if (dentro(cad) && dentro(r)) {
        // la otra pierna (una rodilla abajo y un pie adelante)
        apuntar(l + 'UpperLeg', v3().subVectors(W[r], W[cad]), 0.4);
        apuntar(l + 'LowerLeg', dentro(tob) ? v3().subVectors(W[tob], W[r]) : abajo, 0.4);
        const pie = hueso(l + 'Foot'); if (pie) pie.quaternion.slerp(q4(), 0.15);
      }
    }
  } else if (piernas) {
    const arriba = v3().addVectors(W[11], W[12]).sub(v3().addVectors(W[23], W[24]));
    ponerGiroMundo('hips', giroDeBase(reposoDir.torsoArriba, reposoDir.caderaLado, arriba, v3().subVectors(W[24], W[23])), 0.4);
    for (const [l, cad, rod, tob, pun] of [['left', 24, 26, 28, 32], ['right', 23, 25, 27, 31]]) {
      apuntar(l + 'UpperLeg', v3().subVectors(W[rod], W[cad]));
      apuntar(l + 'LowerLeg', v3().subVectors(W[tob], W[rod]));
      if (dentro(pun)) apuntar(l + 'Foot', v3().subVectors(W[pun], W[tob]));
    }
  } else if (ahora - piernasVistas > 1200) {
    // No se ven tus pies: las piernas acompañan solas.
    //  - Si bajas los hombros respecto de cuando estabas de pie, dobla las rodillas (sentadilla)
    //  - Si te inclinas a un lado, el peso va a esa pierna y la otra rodilla se afloja un poco
    let doblar = 0, apoyo = null;
    if (ve(11) && ve(12)) {
      const y = (P[11].y + P[12].y) / 2, ancho = Math.max(0.05, Math.hypot(P[11].x - P[12].x, P[11].y - P[12].y));
      if (hombrosDePie === null || y < hombrosDePie) hombrosDePie = y; else hombrosDePie += (y - hombrosDePie) * 0.003;
      doblar = Math.max(0, Math.min(1, ((y - hombrosDePie) / ancho - 0.25) / 1.2));
      if (ve(23) && ve(24)) {
        const mx = (P[11].x + P[12].x) / 2, dl = Math.abs(P[24].x - mx), dr = Math.abs(P[23].x - mx);
        if (Math.abs(dl - dr) > 0.15 * ancho) apoyo = dl < dr ? 'left' : 'right';
      }
    }
    const abajo = reposoDir.torsoArriba.clone().negate(), frente = reposoDir.frente;
    for (const l of ['left', 'right']) {
      const ang = (doblar * 70 + (apoyo && apoyo !== l ? 14 : 0)) * Math.PI / 180;
      apuntar(l + 'UpperLeg', abajo.clone().multiplyScalar(Math.cos(ang)).add(frente.clone().multiplyScalar(Math.sin(ang))), 0.15);
      apuntar(l + 'LowerLeg', abajo.clone().multiplyScalar(Math.cos(ang)).sub(frente.clone().multiplyScalar(Math.sin(ang))), 0.15);
      const pie = hueso(l + 'Foot'); if (pie) pie.quaternion.slerp(q4(), 0.15);
    }
    const hc = hueso('hips'); if (hc) hc.quaternion.slerp(q4(), 0.15);
  }
  if (!piernas && !conRodilla && !cuatroPatas && P) {
    // Cada pierna por separado: si se ve tu rodilla (por ejemplo al subirla o patear), el muslo la copia;
    // si además se ve el tobillo, la canilla también. Si no, la canilla cuelga hacia abajo
    const clara = i => (P[i].visibility ?? 1) > 0.6 && P[i].y < 0.97 && P[i].x > 0.01 && P[i].x < 0.99;
    for (const [l, cad, rd, tob] of [['left', 24, 26, 28], ['right', 23, 25, 27]]) {
      if (!(clara(cad) && clara(rd))) continue;
      apuntar(l + 'UpperLeg', v3().subVectors(W[rd], W[cad]), 0.5);
      apuntar(l + 'LowerLeg', clara(tob) ? v3().subVectors(W[tob], W[rd]) : reposoDir.torsoArriba.clone().negate(), 0.5);
    }
  }
  // Lo más bajo queda apoyado en el piso; al saltar, se despega
  if (P) { const salto = conRodilla || cuatroPatas ? 0 : medirSalto(P, vh, ahora); apoyarEnPiso(salto, salto > 0 ? 0.7 : 0.4); window.__salto = salto; }
  visto.pies = piernas || conRodilla || cuatroPatas;
  vrm.scene.updateMatrixWorld(true);

  // Torso: la línea de los hombros (gira e inclina)
  if (ve(11) && ve(12)) {
    const lado = v3().subVectors(W[12], W[11]);
    // las caderas solo cuentan si se ven dentro de la imagen (sentado de cerca el detector las inventa)
    const cadera = i => ve(i) && (P[i].visibility ?? 1) > 0.7 && P[i].y < 0.95;
    const conCadera = (cadera(23) && cadera(24)) || cuatroPatas || giroCadera;
    const arriba = conCadera ? v3().addVectors(W[11], W[12]).sub(v3().addVectors(W[23], W[24])) : reposoDir.torsoArriba.clone();
    const g = giroDeBase(reposoDir.torsoArriba, reposoDir.torsoLado, arriba, lado);
    // límites de un torso de persona: gira hasta 60°; se inclina 35° (hasta 90° adelante si la cadera se ve clara)
    { const eu = new THREE.Euler().setFromQuaternion(g, 'YXZ'), lim = (v, m) => Math.max(-m, Math.min(m, v));
      eu.x = Math.max(-0.61, Math.min(conCadera ? 1.6 : 0.61, eu.x)); eu.y = lim(eu.y, 1.05); eu.z = lim(eu.z, 0.61); g.setFromEuler(eu); }
    ponerGiroMundo('spine', (giroCadera ? giroCadera.clone() : q4()).slerp(g, 0.5), 0.4);
    ponerGiroMundo('chest', g, 0.4);
  }
  vrm.scene.updateMatrixWorld(true);

  // Ojos en la imagen (centro de las pupilas) y en el personaje
  let ojosImg = null, ojoDistImg = 0;
  if (ultimaCara && ultimaCara.length > 473) {
    const a = img(ultimaCara[468]), b = img(ultimaCara[473]);
    ojosImg = a.clone().add(b).multiplyScalar(0.5); ojoDistImg = a.distanceTo(b);
    ojosRecordados = { ojosImg, ojoDistImg, t: ahora };
  } else if (ojosRecordados && ahora - ojosRecordados.t < 1500) {
    // Tu mano tapa la cara y la cámara la pierde: se usa dónde estaba hace un momento
    ({ ojosImg, ojoDistImg } = ojosRecordados);
  }
  const ojosAv = ojosAvatar();
  // Tu cara como marco de medida; si tu mano la tapa, se usa la de hace un momento
  let marco = null;
  if (ultimaCara && ultimaCara.length > 454) { marco = marcoDeCara(ultimaCara, vw, vh, ahora); marcoRecordado = { marco, t: ahora }; }
  else if (marcoRecordado && ahora - marcoRecordado.t < 1500) marco = marcoRecordado.marco;

  // Brazos: se calcula dónde tiene que quedar la muñeca y el brazo se acomoda para llegar.
  //  - Lejos de la cara: igual que tu brazo, medido desde el hombro.
  //  - Cerca de la cara: en el mismo lugar respecto de los ojos (si te tocas la mejilla, ella también).
  visto.brazos = 0;
  // Un punto del brazo vale solo si se ve claro y está dentro de la imagen. De costado, el brazo
  // que queda detrás de tu cuerpo lo inventa el detector: ese solo vale si la cámara ve la mano
  // o si el detector está muy seguro
  const hw = ultimaPose ? ultimaPose.w : null;
  const deCostado = !!hw && Math.abs(hw[11].z - hw[12].z) > Math.abs(hw[11].x - hw[12].x);   // giraste más de 45°
  const brazoAtras = deCostado ? (ultimaPose.w[11].z > ultimaPose.w[12].z ? 'right' : 'left') : null;
  // sin tu mano a la vista, una muñeca pegada al borde de abajo suele ser inventada (brazos fantasma)
  const veB = (i, lado) => !!P && (P[i].visibility ?? 1) > 0.65 && P[i].x > 0.01 && P[i].x < 0.99 && P[i].y > 0.01 && P[i].y < 0.97 &&
    ((i !== 15 && i !== 16) || !!manos[lado === 'left' ? 'Left' : 'Right'] || ((P[i].visibility ?? 1) > 0.8 && P[i].y < 0.9)) &&
    (lado !== brazoAtras || !!manos[lado === 'left' ? 'Left' : 'Right'] || (P[i].visibility ?? 1) > 0.85);
  for (const [lado, hombro, codo, muneca] of [['left', 12, 14, 16], ['right', 11, 13, 15]]) {
    const manoLm = manos[lado === 'left' ? 'Left' : 'Right'];
    const munecaImg = manoLm ? img(manoLm[0]) : (veB(muneca, lado) ? img(P[muneca]) : null);
    let destino = null, cerca = 0;
    if (ve(hombro) && veB(muneca, lado)) {
      const largoPersona = veB(codo, lado) ? W[codo].distanceTo(W[hombro]) + W[muneca].distanceTo(W[codo]) : 0.55 * (pxPorMetro || vh);
      const escala = (medidas[lado + 'Brazo'] + medidas[lado + 'Antebrazo']) / Math.max(0.2 * (pxPorMetro || vh), largoPersona);
      destino = hueso(lado + 'UpperArm').getWorldPosition(v3()).add(v3().subVectors(W[muneca], W[hombro]).multiplyScalar(escala));
    }
    const M = manosF[lado];
    if (marco && manoLm && M && ahora - M.t < 350) {
      // Tu mano cerca de tu cara: va al mismo lugar de su cara (mejilla con mejilla, mentón con mentón)
      const r = manoEnSuCara(lado, M.H, marco);
      if (r && r.cerca > 0) { cerca = r.cerca; destino = destino ? destino.lerp(r.destino, cerca) : r.destino; }
    }
    if (!destino) {
      // No se ve el brazo: baja despacio en vez de quedar en una pose rara
      apuntar(lado + 'UpperArm', new THREE.Vector3(lado === 'left' ? 0.25 : -0.25, -1, 0), 0.08);
      apuntar(lado + 'LowerArm', new THREE.Vector3(lado === 'left' ? 0.15 : -0.15, -1, 0.15), 0.08);
      destinos[lado] = null;
      continue;
    }
    visto.brazos++;
    // Hacia dónde va el codo: el tuyo si se ve; si no, hacia abajo y afuera
    const codoHacia = veB(codo, lado) && ve(hombro) && veB(muneca, lado)
      ? v3().subVectors(W[codo], v3().addVectors(W[hombro], W[muneca]).multiplyScalar(0.5))
      : new THREE.Vector3(lado === 'left' ? 0.4 : -0.4, -1, -0.3);
    // Límite de velocidad: la mano no puede saltar más de 4 m por segundo (un error no la hace volar)
    const prev = destinos[lado];
    if (prev) {
      const paso = v3().subVectors(destino, prev), tope = 4 * Math.min(0.1, Math.max(0.008, (ahora - (tiempoDestino[lado] || ahora)) / 1000));
      if (paso.length() > tope && !PRUEBA.has('a')) destino = prev.clone().add(paso.setLength(tope));
    }
    tiempoDestino[lado] = ahora;
    destinos[lado] = prev && !PRUEBA.has('d') ? prev.lerp(destino, 0.8 + 0.2 * cerca) : destino;
    codosHacia[lado] = codoHacia;
    alcanzar(lado, destinos[lado], codoHacia);
    medir(lado, munecaImg, ojosImg, ojoDistImg, cerca, P);
  }
  // Manos y dedos
  for (const lado of ['left', 'right']) {
    const M = manosF[lado];
    if (!M || ahora - M.t > 350) {
      for (const [d, partes] of Object.entries(DEDOS)) for (const parte of partes) { const b = hueso(lado + d + parte); if (b) b.quaternion.slerp(q4(), 0.1); }
      continue;
    }
    const H = M.H;
    const adelante = v3().subVectors(H[9], H[0]), costado = v3().subVectors(H[17], H[5]);
    const g = giroDeBase(reposoDir[lado + 'HandAdelante'], reposoDir[lado + 'HandLado'], adelante, costado);
    ponerGiroMundo(lado + 'Hand', g, 0.5);
    for (const [d, partes] of Object.entries(DEDOS)) {
      partes.forEach((parte, k) => { const [a, b] = PUNTOS_DEDO[d][k]; apuntar(lado + d + parte, v3().subVectors(H[b], H[a]), 0.6); });
    }
  }
  // Cabeza: su giro sale de la cara (como espejo); boca y ojos de los gestos de la cara
  if (caraMatriz) {
    const m = new THREE.Matrix4().fromArray(caraMatriz), r = new THREE.Matrix4().extractRotation(m);
    const e = r.elements;                          // espejo: se invierte lo que cruza el eje x
    e[1] = -e[1]; e[2] = -e[2]; e[4] = -e[4]; e[8] = -e[8];
    const g = q4().setFromRotationMatrix(r);
    // límites de una cabeza de persona (si tus manos tapan la cara, la cámara a veces exagera)
    const eu = new THREE.Euler().setFromQuaternion(g, 'YXZ'), lim = (v, m) => Math.max(-m, Math.min(m, v));
    eu.x = lim(eu.x, 0.52); eu.y = lim(eu.y, 0.87); eu.z = lim(eu.z, 0.52);
    g.setFromEuler(eu);
    ponerGiroMundo('neck', q4().slerp(g, 0.4), 0.5);
    ponerGiroMundo('head', g, 0.5);
    caraVista = ahora;
  } else if (ahora - caraVista > 600) {
    // la cámara perdió tu cara: la cabeza vuelve derecha despacio (no queda torcida)
    for (const n of ['neck', 'head']) { const h = hueso(n); if (h) h.quaternion.slerp(q4(), 0.06); }
  }
  // Manos y dedos no entran en el cuerpo: se apoyan en la piel
  vrm.scene.updateMatrixWorld(true); actualizarSuperficie();
  for (const l of ['left', 'right']) sacarDelCuerpo(l);
  separarManos();
  for (const l of ['left', 'right']) sacarDelCuerpo(l);
  if (!PRUEBA.has('f')) for (const l of ['left', 'right']) limitarMuneca(l);
  { const c = limitarDedos('left') + limitarDedos('right'); medida.cuadrosDedos = (medida.cuadrosDedos || 0) + 1; if (c) medida.dedosRaros = (medida.dedosRaros || 0) + 1; window.__manosRaras = { cuadros: medida.cuadrosDedos, conDedosRaros: medida.dedosRaros || 0 }; }
  contarDentro();
  medirTodo(P);
  medirManoEnCara(marco);
  if (caraGestos && ultimaCara) mirarEmocion(ultimaCara, vw, vh, ahora);
  if (caraGestos && ultimaCara) ponerEmocion(emocionVtuber(caraGestos, medirEmocion(caraGestos, ultimaCara, dtCara(ahora), ahora))); else ponerEmocion(null);
  if (caraGestos) {
    const G = caraGestos, ojo = v => Math.max(0, Math.min(1, (v - 0.3) / 0.4));
    gesto('blink', 0);
    // Unos ojos chicos no son ojos cerrados: se compara con cómo los tienes tú en los últimos 6 s
    const dtG = 1 / 30, cerrado = n => {
      const v = G[n] || 0, h = historiaOjos[n] = historiaOjos[n] || [];
      h.push({ t: ahora, v });
      while (h[0].t < ahora - 6000) h.shift();
      const orden = h.map(m => m.v).sort((a, b) => a - b), normal = orden[Math.floor(orden.length * 0.6)];
      // parpadeo = cuánto se cierra más que lo normal tuyo (antes pedía casi el doble y se perdían los parpadeos cortos)
      return entre01(v - normal, 0.12, 0.28);
    };
    // boca: se compara con tu boca cerrada de los últimos 4 s y se suaviza un poco (no tiembla, pero responde rápido)
    const bocaBase = (n, v) => {
      const h = historiaOjos[n] = historiaOjos[n] || [];
      h.push({ t: ahora, v }); while (h[0].t < ahora - 4000) h.shift();
      const orden = h.map(m => m.v).sort((a, b) => a - b);
      return Math.max(0, v - orden[Math.floor(orden.length * 0.1)]);
    };
    const suave = (n, v) => { const a = bocaSuave[n] || 0; return (bocaSuave[n] = a + (v - a) * (v > a ? 0.7 : 0.45)); };
    // Ojos como en el código VTuber: alto ÷ ancho del ojo comparado con lo abierto que lo tienes tú
    // (sube rápido y baja lento: con lentes o luz baja sigue sabiendo cuál es tu ojo abierto)
    const W = video.videoWidth || 1, Hh = video.videoHeight || 1, P = i => [ultimaCara[i].x * W, ultimaCara[i].y * Hh];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const apertura = (k, idx) => {
      if (!ultimaCara) return 1;
      const [ext, inn, s1, i1, s2, i2] = idx.map(P), ear = (dist(s1, i1) + dist(s2, i2)) / (2 * dist(ext, inn) + 1e-6);
      let b = baseOjo[k]; b += (ear - b) * (ear > b ? 0.05 : 0.003); baseOjo[k] = Math.max(0.15, Math.min(0.5, b));
      return entre01(ear / baseOjo[k], 0.45, 0.8);
    };
    const ojoCerrado = (k, idx, bsNombre) => {
      const forma = 1 - apertura(k, idx), bs = entre01(G[bsNombre] || 0, 0.4, 0.65);
      const v = Math.max(forma, bs, cerrado(bsNombre) * 0.6);
      return (ojoSuave[k] += (v - ojoSuave[k]) * (v > ojoSuave[k] ? 0.85 : 0.6));
    };
    const pi = ojoCerrado(0, [33, 133, 160, 144, 158, 153], 'eyeBlinkRight'), pd = ojoCerrado(1, [263, 362, 387, 373, 385, 380], 'eyeBlinkLeft');
    ojosCerrados = Math.max(pi, pd);
    gesto('blinkLeft', pi); gesto('blinkRight', pd);   // espejo
    // personajes sin un ojo por separado: cierran los dos juntos
    const unOjo = vrm.expressionManager && vrm.expressionManager.getExpression('blinkLeft');
    if (!unOjo || !(unOjo._binds || unOjo.binds || []).length) gesto('blink', Math.max(pi, pd));
    gesto('aa', Math.max(suave('aa', entre01(bocaBase('jawOpen', G.jawOpen || 0), 0.05, 0.33)), volumenVoz()));
    gesto('ou', suave('ou', entre01(G.mouthPucker || 0, 0.12, 0.75)));
    gesto('oh', suave('oh', entre01(G.mouthFunnel || 0, 0.08, 0.6)));
    gesto('ee', suave('ee', entre01((G.mouthStretchLeft || 0) + (G.mouthStretchRight || 0), 0.08, 0.7)));
    gesto('ih', suave('ih', entre01(bocaBase('sonrisa', ((G.mouthSmileLeft || 0) + (G.mouthSmileRight || 0)) / 2), 0.08, 0.6) * 0.8));
    if (PRUEBA.has('medircara')) {
      const M = window.__cara = window.__cara || { n: 0, parpadeos: 0, cerr: false, ruido: 0, nQuieta: 0, maxAa: 0, aaAntes: 0 };
      const aa = vrm.expressionManager ? vrm.expressionManager.getValue('aa') : 0;
      M.n++; if (ojosCerrados > 0.5 && !M.cerr) M.parpadeos++; M.cerr = ojosCerrados > 0.5;
      if ((G.jawOpen || 0) < 0.08) { M.ruido += Math.abs(aa - M.aaAntes); M.nQuieta++; }
      M.maxAa = Math.max(M.maxAa, aa); M.aaAntes = aa;
      const rb = Math.max(G.eyeBlinkLeft || 0, G.eyeBlinkRight || 0); (M.rb = M.rb || []).push(+rb.toFixed(2)); (M.rj = M.rj || []).push(+(G.jawOpen || 0).toFixed(2));
    }
  }
}
const bocaSuave = {}, baseOjo = [0.28, 0.28], ojoSuave = [0, 0];
let manosF = { left: null, right: null }, manoAntes = {}, manosVistas = [], cuerpoF = null, caraMatriz = null, caraGestos = null;


/* ---------- Ritmo (sonido hecho en el momento, sin música con derechos) ---------- */
let audio = null, ritmoOn = false, proximoGolpe = 0;
function tocarRitmo() {
  if (!ritmoOn || !audio) return;
  const dur = 60 / BPM;
  while (proximoGolpe < audio.currentTime + 0.2) {
    const t = proximoGolpe, k = Math.round((t - audio.inicio) / dur);
    // bombo en cada golpe
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.2);
    // platillo entre golpes
    const r = audio.createBufferSource(), gr = audio.createGain(), f = audio.createBiquadFilter();
    r.buffer = audio.ruido; f.type = 'highpass'; f.frequency.value = 7000;
    gr.gain.setValueAtTime(k % 2 ? 0.18 : 0.08, t + dur / 2); gr.gain.exponentialRampToValueAtTime(0.001, t + dur / 2 + 0.05);
    r.connect(f).connect(gr).connect(audio.destination); r.start(t + dur / 2); r.stop(t + dur / 2 + 0.06);
    proximoGolpe += dur;
  }
}
$('musica').onclick = () => {
  if (!audio) {
    audio = new AudioContext();
    audio.ruido = audio.createBuffer(1, audio.sampleRate * 0.1, audio.sampleRate);
    const d = audio.ruido.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  ritmoOn = !ritmoOn; $('musica').classList.toggle('on', ritmoOn); ponerTexto($('musica'), ritmoOn ? '🔊 Ritmo' : '🔈 Ritmo');
  if (ritmoOn) {
    audio.resume();
    // El ritmo empieza en el mismo golpe en que va el baile
    const dur = 60 / BPM, b = (performance.now() - inicioBaile) / 1000 / dur;
    audio.inicio = audio.currentTime - (b % 1) * dur; proximoGolpe = audio.inicio + dur;
  }
};

/* ---------- Botones ---------- */
function avisarCamaraLlamada(ok) {
  if (!MODO_LLAMADA) return;
  fetch('/llamadas/camara', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok, motivo: motivoCamara || 'no se preparó la detección' }) }).catch(() => {});
}
$('bailar').onclick = () => {
  modo = 'bailar'; apagarCamara(); inicioBaile = performance.now();
  $('bailar').classList.add('on'); $('camara').classList.remove('on'); ponerTexto($('camara'), '📷 Cámara'); aviso('');
};
$('camara').onclick = async () => {
  if (modo === 'camara') { $('bailar').click(); return; }
  $('camara').classList.add('on'); $('bailar').classList.remove('on'); ponerTexto($('camara'), '📷 Cámara');
  if (await prenderCamara()) { modo = 'camara'; avisarCamaraLlamada(true); }
  else {
    $('bailar').click();
    // En una llamada la cámara puede estar ocupada un momento: se reintenta y se avisa a la página principal
    if (MODO_LLAMADA) { avisarCamaraLlamada(false); setTimeout(() => $('camara').click(), 3000); }
  }
};
/* ---------- Menú del personaje: cuerpo, ropa, cara y orejas ---------- */
const PARTES_CUERPO = [['altura', 'Altura'], ['cabeza', 'Cabeza'], ['hombros', 'Hombros'], ['brazos', 'Brazos'], ['manos', 'Manos'], ['piernas', 'Piernas'], ['pies', 'Pies']];
const TINTES = { ropaArriba: /Onepiece|Tops/i, ropaAbajo: /Bottoms/i, zapatos: /Shoes/i, ojos: /EyeIris/i, pelo: /Hair/i, orejas: /Accessory|CatEar/i };
const PALETA = ['#ffffff', '#93c5fd', '#fda4af', '#fca5a5', '#86efac', '#c4b5fd', '#fde68a', '#6b7280'];
const nuevosAjustes = () => ({ cuerpo: Object.fromEntries(PARTES_CUERPO.map(([k]) => [k, 100])), tinte: {}, sinOrejas: false });
let ajustes = nuevosAjustes(), pestana = 'Personajes', pieBase = null, esperaMedir = 0, posOriginal = new Map();
const unirAjustes = g => (g && g.cuerpo ? { ...nuevosAjustes(), ...g, cuerpo: { ...nuevosAjustes().cuerpo, ...g.cuerpo } } : nuevosAjustes());
let esperaAjustes = 0;
function guardarAjustes() {
  clearTimeout(esperaAjustes);
  const id = misPersonajes.actual, copia = JSON.parse(JSON.stringify(ajustes));
  const p = misPersonajes.lista.find(x => x.id === id); if (p) p.ajustes = copia;
  esperaAjustes = setTimeout(() => { postJSON('/personajes/ajustes', { id, ajustes: copia }).catch(() => {}); }, 250);
}
const nodos = n => [vrm.humanoid.getNormalizedBoneNode(n), vrm.humanoid.getRawBoneNode(n)].filter(Boolean);
// El tamaño se cambia en los dos esqueletos del personaje; así los choques y el seguimiento siguen midiendo bien
function ponerCuerpo() {
  const c = ajustes.cuerpo, f = k => c[k] / 100, escala = (n, v) => nodos(n).forEach(b => b.scale.setScalar(v));
  vrm.scene.scale.setScalar(f('altura'));
  escala('head', f('cabeza'));
  for (const l of ['left', 'right']) {
    escala(l + 'UpperArm', f('brazos')); escala(l + 'Hand', f('manos') / f('brazos'));
    escala(l + 'UpperLeg', f('piernas')); escala(l + 'Foot', f('pies') / f('piernas'));
    nodos(l + 'UpperArm').forEach(b => {
      if (!posOriginal.has(b)) posOriginal.set(b, b.position.clone());
      b.position.copy(posOriginal.get(b)).multiplyScalar(1 + (f('hombros') - 1) * 2.5);
    });
  }
  // los pies quedan en el piso aunque cambien las piernas o la altura
  vrm.humanoid.resetNormalizedPose(); vrm.scene.position.y = 0; vrm.scene.updateMatrixWorld(true);
  const dedo = Math.min(...['left', 'right'].map(l => (hueso(l + 'Toes') || hueso(l + 'Foot')).getWorldPosition(v3()).y));
  if (pieBase === null) pieBase = dedo / f('altura');
  vrm.scene.position.y = pieBase * f('altura') - dedo;
}
function medirDespues() {
  clearTimeout(esperaMedir);
  esperaMedir = setTimeout(() => { if (!vrm) return; medirReposo(); if (vrm.springBoneManager) { vrm.springBoneManager.setInitState(); vrm.springBoneManager.reset(); } }, 250);
}
// Colores: se tiñe sobre el color original de cada parte, y sin tinte vuelve a como era
function materialesDe(grupo) {
  const lista = [];
  vrm.scene.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material)) if (TINTES[grupo].test(m.name) && !/Outline/i.test(m.name) && m.color) lista.push({ m, o }); });
  return lista;
}
function ponerColores() {
  for (const grupo of Object.keys(TINTES)) {
    const tinte = new THREE.Color(ajustes.tinte[grupo] || '#ffffff');
    for (const { m, o } of materialesDe(grupo)) {
      if (!m.userData.colorOriginal) m.userData.colorOriginal = { c: m.color.clone(), s: m.shadeColorFactor ? m.shadeColorFactor.clone() : null };
      m.color.copy(m.userData.colorOriginal.c).multiply(tinte);
      if (m.userData.colorOriginal.s) m.shadeColorFactor.copy(m.userData.colorOriginal.s).multiply(tinte);
      if (grupo === 'orejas') o.visible = !ajustes.sinOrejas;
    }
  }
}
// Conjuntos de ropa: la misma prenda con otra textura (no se rompe al bailar). Carpeta ropas/<personaje>/
const CONJUNTOS = { Shibahu: { carpeta: 'ropas/shibahu', partes: { CosA_mt: 'A', CosB_mt: 'B' },
  lista: [['hoy', 'Como está hoy', ['#4a3326', '#e9e4f5', '#2f54a8']], ['escolar', 'Escolar azul y blanco', ['#1e3a8a', '#ffffff', '#f59e0b']],
    ['zorra', 'Zorra naranja', ['#ea7a1c', '#ffffff', '#7c3a12']], ['noche', 'De noche', ['#1c1326', '#7e3fbf', '#d8c4f5']]] } };
const texturasRopa = {}, cargadorTex = new THREE.TextureLoader();
const conjuntosDe = () => (vrm && vrm.meta && CONJUNTOS[vrm.meta.name || vrm.meta.title]) || null;
function ponerConjunto() {
  const c = conjuntosDe(); if (!c) return;
  const elegido = ajustes.conjunto || 'hoy';
  vrm.scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      const letra = c.partes[m.name.replace(/ \(Outline\)$/, '')]; if (!letra || !m.map) continue;
      if (!m.userData.mapaOriginal) m.userData.mapaOriginal = m.map;
      let tx = m.userData.mapaOriginal;
      if (elegido !== 'hoy') {
        const url = `${c.carpeta}/${elegido}_${letra}.jpg`;
        tx = texturasRopa[url] || (texturasRopa[url] = cargadorTex.load(url, x => { x.flipY = false; x.colorSpace = THREE.SRGBColorSpace; }));
      }
      m.map = tx; if ('shadeMultiplyTexture' in m) m.shadeMultiplyTexture = tx; m.needsUpdate = true;
    }
  });
}
function aplicarAjustes() { pieBase = null; posOriginal = new Map(); ponerCuerpo(); ponerColores(); ponerConjunto(); medirReposo(); }
function filaColores(grupo, titulo) {
  if (!materialesDe(grupo).length) return '';
  const elegido = ajustes.tinte[grupo] || '#ffffff';
  return `<div class="grupo">${titulo}</div><div class="colores">` + PALETA.map(c => `<button data-grupo="${grupo}" data-color="${c}" class="${c === elegido ? 'on' : ''}" style="background:${c}" aria-label="${c === '#ffffff' ? 'Color original' : 'Color ' + c}"></button>`).join('') + '</div>';
}
function dibujarPanel() {
  verBotonZorra();
  const p = $('panel'), P = ['Personajes', 'Cuerpo', 'Ropa', 'Cara', 'Orejas'];
  let dentro = '';
  if (pestana === 'Personajes') dentro = `<div id="listaPersonajes">${misPersonajes.lista.map(x => `<div class="carta ${x.id === misPersonajes.actual ? 'on' : ''}" data-elegir="${esc(x.id)}" role="button" tabindex="0">${x.foto ? `<img src="${esc(x.foto)}" alt="">` : '<div class="sinFoto"></div>'}<span>${esc(x.nombre)}</span>${x.id === 'original' || x.incluido || modoWeb ? '' : `<button class="quitarCarta" data-quitar="${esc(x.id)}" aria-label="Quitar ${esc(x.nombre)}">×</button>`}</div>`).join('')}</div><div id="revisionPersonaje" class="${revisionPersonaje.clase}">${esc(revisionPersonaje.texto)}</div>`;
  if (pestana === 'Cuerpo') dentro = PARTES_CUERPO.map(([k, t]) => `<label class="fila">${t}<input type="range" min="80" max="120" value="${ajustes.cuerpo[k]}" data-parte="${k}"><span>${ajustes.cuerpo[k]}%</span></label>`).join('');
  const cj = conjuntosDe(), filaConjuntos = cj ? `<div class="grupo">Conjunto</div><div class="conjuntos">${cj.lista.map(([k, n, cs]) => `<button data-conjunto="${k}" class="${(ajustes.conjunto || 'hoy') === k ? 'on' : ''}"><span class="muestra">${cs.map(c => `<i style="background:${c}"></i>`).join('')}</span>${n}</button>`).join('')}</div>` : '';
  if (pestana === 'Ropa') dentro = filaConjuntos + (filaColores('ropaArriba', 'Arriba') + filaColores('ropaAbajo', 'Abajo') + filaColores('zapatos', 'Zapatos')) || (cj ? '' : '<p class="nada">Este personaje no trae ropa que se pueda teñir.</p>');
  if (pestana === 'Cara') dentro = (filaColores('ojos', 'Ojos') + filaColores('pelo', 'Pelo')) || '<p class="nada">Este personaje no trae ojos ni pelo que se puedan teñir.</p>';
  if (pestana === 'Orejas') dentro = materialesDe('orejas').length ? `<button class="quitar" id="quitarOrejas">${ajustes.sinOrejas ? 'Poner orejas' : 'Quitar orejas'}</button>` + filaColores('orejas', 'Color') : '<p class="nada">Este personaje no trae orejas aparte.</p>';
  p.innerHTML = `<div class="pest">${P.map(n => `<button data-pest="${n}" class="${n === pestana ? 'on' : ''}">${n}</button>`).join('')}</div>${dentro}
    <div class="pie">${pestana === 'Personajes' ? (modoWeb ? '<p class="nada">Para subir tus personajes usa la aplicación para PC.</p>' : '<label class="boton">📂 Subir personaje (.vrm)<input id="archivo" type="file" accept=".vrm"></label>') : '<button id="comoEra">Volver a como era</button>'}</div>`;
  p.querySelectorAll('[data-pest]').forEach(b => b.onclick = () => { pestana = b.dataset.pest; dibujarPanel(); });
  p.querySelectorAll('[data-parte]').forEach(r => r.oninput = () => {
    ajustes.cuerpo[r.dataset.parte] = +r.value; r.nextElementSibling.textContent = r.value + '%';
    ponerCuerpo(); medirDespues(); guardarAjustes();
  });
  p.querySelectorAll('[data-conjunto]').forEach(b => b.onclick = () => { ajustes.conjunto = b.dataset.conjunto; ponerConjunto(); guardarAjustes(); dibujarPanel(); });
  p.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { ajustes.tinte[b.dataset.grupo] = b.dataset.color; ponerColores(); guardarAjustes(); dibujarPanel(); });
  const q = $('quitarOrejas'); if (q) q.onclick = () => { ajustes.sinOrejas = !ajustes.sinOrejas; ponerColores(); guardarAjustes(); dibujarPanel(); };
  if ($('comoEra')) $('comoEra').onclick = () => { ajustes = nuevosAjustes(); ponerCuerpo(); ponerColores(); ponerConjunto(); medirDespues(); guardarAjustes(); dibujarPanel(); };
  if ($('archivo')) $('archivo').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) subirPersonaje(f); };
  p.querySelectorAll('[data-elegir]').forEach(c => {
    c.onclick = ev => { if (!ev.target.dataset.quitar) elegirPersonaje(c.dataset.elegir); };
    c.onkeydown = ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === c) { ev.preventDefault(); elegirPersonaje(c.dataset.elegir); } };
  });
  p.querySelectorAll('[data-quitar]').forEach(b => b.onclick = () => quitarPersonaje(b.dataset.quitar));
}
$('personaje').onclick = () => { const ver = $('panel').classList.toggle('ver'); $('personaje').classList.toggle('on', ver); if (ver) dibujarPanel(); };
// En este PC el botón prende OBS y la voz; en otro aparato solo se puede mostrar la guía
// en la página web (Render) no hay llamadas, voz Kusuri ni subir personajes: eso es de la aplicación para PC
let modoWeb = !['localhost', '127.0.0.1'].includes(location.hostname);
fetch('/modo').then(r => r.json()).then(m => { modoWeb = !!m.web; document.body.classList.toggle('web', modoWeb); }).catch(() => {});
document.body.classList.toggle('web', modoWeb);
const enEstePC = ['localhost', '127.0.0.1'].includes(location.hostname);
const postJSON = (ruta, datos = {}) => fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
function avisoLlamada(html, clase = '') { const a = $('avisoLlamada'); a.innerHTML = html; a.className = clase; a.style.display = html ? 'block' : 'none'; }
let llamadaVista = false, esperaLlamada = 0;
async function verLlamada() {
  if (modoWeb) return;   // en la página web no hay llamadas
  let e;
  try { e = await (await fetch('/llamadas/estado')).json(); } catch (x) { avisoLlamada('<b>Se perdió la conexión con el servidor.</b>', 'mal'); return; }
  const b = $('llamadas');
  if (e.fase === 'prendiendo') { avisoLlamada('Prendiendo OBS y la cámara para llamadas…'); ponerTexto(b, '⏳ Configurando…'); setTimeout(verLlamada, 800); return; }
  clearTimeout(esperaLlamada);
  if (e.fase === 'prendido') {
    if (e.camara && e.camara.ok) avisoLlamada('<b>✔ Ya puedes llamar</b>En Zoom o Meet elige la cámara «OBS Virtual Camera» y el micrófono «CABLE Output».', 'listo');
    else if (e.camara) avisoLlamada('<b>Ella aún no te copia: no se abre tu cámara.</b>Cierra lo que la esté usando; en Meet elige «OBS Virtual Camera». Sigo intentando. (' + e.camara.motivo.replace(/[<>&]/g, '') + ')', 'mal');
    else avisoLlamada('Preparando tu personaje para la llamada…');
    ponerTexto(b, '⏹ Terminar'); b.classList.add('on');
    if (!llamadaVista) { llamadaVista = true; if (deCerca !== (e.cerca !== false)) $('cerca').click(); await salidaVoz(true); if (!vozOn) prenderVozKusuri(); }
    esperaLlamada = setTimeout(verLlamada, 2000);
    return;
  }
  llamadaVista = false;
  ponerTexto(b, '📺 Llamadas'); b.classList.remove('on');
  await salidaVoz(false);
  avisoLlamada(e.fase === 'error' ? '<b>No se pudo prender.</b>' + e.error : '', e.fase === 'error' ? 'mal' : '');
}
$('llamadas').onclick = async () => {
  if (!enEstePC) { $('guia').showModal(); return; }
  if ($('llamadas').classList.contains('on')) {
    avisoLlamada('Apagando…');
    try { await postJSON('/llamadas/apagar'); } catch (x) {}
    apagarVozKusuri();
    verLlamada(); return;
  }
  // OBS usa la cámara: aquí se suelta para no gastar el doble
  if (modo === 'camara') $('bailar').click();
  try { await postJSON('/llamadas/prender'); } catch (x) {}
  verLlamada();
};

/* ---------- Voz de Kusuri: lo que dices se convierte en texto y ella lo dice ---------- */
const PAUSA_FRASE = 700, PAUSA_CORTA = 1600, MIN_PALABRAS = 4, PALABRAS_POR_TROZO = 12, GUARDAR = 3, MAX_LETRAS = 380, GANANCIA_MIC = 3;
const sonidoVoz = new Audio();
let vozOn = false, enLlamadaVoz = false, reconocedor = null, colaVoz = [], vozOcupada = false, finDeVoz = 0;
let dichas = [], esperaPausa = 0, pistaMic = null, flujoMic = null, ctxMic = null, analizadorVoz = null, datosAnalizador = null, ctxVoz = null, ultimoNivel = 0;
const estadoVoz = (texto, mal = false) => { $('vozEstado').textContent = texto; $('vozEstado').classList.toggle('mal', mal); };

async function salidaVoz(cable) {
  enLlamadaVoz = cable;
  if (!sonidoVoz.setSinkId) return;
  try {
    let destino = '';
    if (cable) {
      const lista = await navigator.mediaDevices.enumerateDevices();
      const d = lista.find(x => x.kind === 'audiooutput' && x.deviceId !== 'default' && x.deviceId !== 'communications' && /VB-Audio/i.test(x.label) && !/16 Ch/i.test(x.label));
      if (!d) { estadoVoz('No encuentro el cable de audio: la llamada no la oirá.', true); return; }
      destino = d.deviceId;
    }
    await sonidoVoz.setSinkId(destino);
  } catch (e) { estadoVoz('No pude cambiar la salida de audio.', true); }
}

function medirVoz() {
  let nivel = 0;
  if (analizadorVoz && !sonidoVoz.paused) {
    analizadorVoz.getByteTimeDomainData(datosAnalizador);
    let s = 0; for (const v of datosAnalizador) s += (v - 128) * (v - 128);
    nivel = Math.max(0, Math.min(1, (Math.sqrt(s / datosAnalizador.length) / 128 - 0.01) * 6));
  }
  nivelKusuri = nivel;
  // La boca del personaje de la llamada vive en OBS: se le avisa por el servidor
  if (enLlamadaVoz && Math.abs(nivel - ultimoNivel) > 0.03) { ultimoNivel = nivel; postJSON('/voz/boca', { v: nivel }).catch(() => {}); }
}
setInterval(medirVoz, 80);

async function siguienteVoz() {
  if (vozOcupada || !colaVoz.length) return;
  vozOcupada = true;
  // Lo que se juntó mientras hablaba se dice de una vez, para que no haya tantos cortes
  let texto = colaVoz.shift();
  while (colaVoz.length && texto.length + colaVoz[0].length < MAX_LETRAS) texto += ' ' + colaVoz.shift();
  recientes.push({ t: performance.now(), palabras: new Set(normalizar(texto)) });
  estadoVoz('Dice: ' + texto);
  try {
    const r = await postJSON('/voz/pedir', { texto });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    sonidoVoz.src = '/voz/audio/' + d.id;
    await sonidoVoz.play();
    window.__vozSono = (window.__vozSono || 0) + 1;
  } catch (e) {
    estadoVoz(e.message || 'No pude reproducir la voz.', true);
    vozOcupada = false; finDeVoz = performance.now(); siguienteVoz();
  }
}
sonidoVoz.onended = sonidoVoz.onerror = () => { vozOcupada = false; finDeVoz = performance.now(); if (!colaVoz.length && vozOn) estadoVoz('Te escucho…'); siguienteVoz(); };
sonidoVoz.onplaying = () => {
  if (analizadorVoz) return;
  try {
    ctxVoz = new AudioContext();
    analizadorVoz = ctxVoz.createAnalyser(); analizadorVoz.fftSize = 512;
    datosAnalizador = new Uint8Array(analizadorVoz.fftSize);
    ctxVoz.createMediaStreamSource(sonidoVoz.captureStream()).connect(analizadorVoz);
  } catch (e) { analizadorVoz = null; }
};
function decirKusuri(texto) { texto = texto.trim(); if (texto.length < 2) return; colaVoz.push(texto); siguienteVoz(); }

// Fuera de una llamada ella suena por los parlantes y el micrófono puede oírla.
// Solo se descarta lo que se parece a lo que ella acaba de decir; lo tuyo sigue pasando.
const recientes = [];
const normalizar = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zñ0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
function esSuEco(palabras) {
  if (enLlamadaVoz || !(vozOcupada || performance.now() - finDeVoz < 1500)) return false;
  const limite = performance.now() - 20000;
  while (recientes.length && recientes[0].t < limite) recientes.shift();
  const lista = normalizar(palabras.join(' '));
  if (!lista.length) return true;
  const iguales = lista.filter(p => recientes.some(r => r.palabras.has(p))).length;
  return iguales / lista.length >= 0.7;
}
// El navegador puede corregir lo que ya entendió: se busca dónde sigue según la última palabra dicha
const separar = t => t.trim().split(/\s+/).filter(Boolean);
function dondeSigue(base) {
  if (!dichas.length) return 0;
  const ultima = dichas[dichas.length - 1];
  for (let p = Math.min(base.length - 1, dichas.length + 3); p >= Math.max(0, dichas.length - 4); p--) if (base[p] === ultima) return p + 1;
  return Math.min(dichas.length, base.length);
}
function mandarNuevas(texto, guardar = 0) {
  const palabras = separar(texto), base = palabras.map(p => normalizar(p).join(''));
  const inicio = dondeSigue(base), hasta = palabras.length - guardar;
  if (hasta <= inicio) return;
  dichas = base.slice(0, hasta);
  const nuevas = palabras.slice(inicio, hasta);
  if (!esSuEco(nuevas)) decirKusuri(nuevas.join(' '));
}
function crearReconocedor() {
  const Clase = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Clase) return null;
  const r = new Clase();
  r.lang = (navigator.language || '').startsWith('es') ? navigator.language : 'es-PE';
  r.continuous = true; r.interimResults = true;
  r.onresult = ev => {
    // Chrome reparte lo provisional en varias partes: se lee como una sola frase
    let provisional = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const texto = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) { clearTimeout(esperaPausa); mandarNuevas(texto); dichas = []; }
      else provisional += texto;
    }
    if (!provisional.trim()) return;
    clearTimeout(esperaPausa);
    if (!vozOcupada && !colaVoz.length) estadoVoz('Entendí: ' + provisional);
    const total = separar(provisional).length;
    if (total - dichas.length >= PALABRAS_POR_TROZO) mandarNuevas(provisional, GUARDAR);
    // Con pocas palabras el texto aún cambia mucho: se espera un poco más a que el navegador lo confirme
    esperaPausa = setTimeout(() => mandarNuevas(provisional), total >= MIN_PALABRAS ? PAUSA_FRASE : PAUSA_CORTA);
  };
  r.onerror = ev => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { estadoVoz('Falta dar permiso al micrófono.', true); apagarVozKusuri(false); }
    else if (ev.error === 'network') estadoVoz('Sin conexión para entender tu voz. Puedes escribir la frase.', true);
  };
  r.onend = () => { dichas = []; if (vozOn) escucharCon(r); };
  return r;
}
// Sube la voz que llega de lejos y deja parejo lo que llega de cerca
async function microfonoSensible() {
  flujoMic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  ctxMic = new AudioContext();
  const compresor = ctxMic.createDynamicsCompressor();
  compresor.threshold.value = -40; compresor.knee.value = 20; compresor.ratio.value = 6; compresor.attack.value = 0.003; compresor.release.value = 0.25;
  const ganancia = ctxMic.createGain(); ganancia.gain.value = GANANCIA_MIC;
  const destino = ctxMic.createMediaStreamDestination();
  ctxMic.createMediaStreamSource(flujoMic).connect(compresor).connect(ganancia).connect(destino);
  return destino.stream.getAudioTracks()[0];
}
function soltarMicrofono() {
  if (flujoMic) flujoMic.getTracks().forEach(t => t.stop());
  if (pistaMic) pistaMic.stop();
  if (ctxMic) ctxMic.close().catch(() => {});
  flujoMic = ctxMic = pistaMic = null;
}
// Los navegadores que no aceptan el micrófono propio usan el normal
function escucharCon(r) {
  try { r.start(pistaMic); }
  catch (e) { if (e.name !== 'InvalidStateError') { try { r.start(); } catch (x) {} } }
}
async function prenderVozKusuri() {
  vozOn = true;
  $('vozKusuri').classList.add('on'); $('cajaVoz').classList.add('ver');
  try { pistaMic = await microfonoSensible(); }
  catch (e) { estadoVoz('Falta dar permiso al micrófono. Puedes escribir la frase.', true); return; }
  if (enLlamadaVoz) await salidaVoz(true);
  reconocedor = crearReconocedor();
  if (!reconocedor) { estadoVoz('Este navegador no entiende voz. Usa Chrome o Edge, o escribe la frase.', true); return; }
  escucharCon(reconocedor); estadoVoz('Te escucho…');
}
function apagarVozKusuri(ocultar = true) {
  vozOn = false; clearTimeout(esperaPausa); colaVoz = [];
  if (reconocedor) { try { reconocedor.abort(); } catch (e) {} reconocedor = null; }
  soltarMicrofono();
  sonidoVoz.pause(); vozOcupada = false; nivelKusuri = 0;
  $('vozKusuri').classList.remove('on');
  if (ocultar) $('cajaVoz').classList.remove('ver');
}
$('vozKusuri').onclick = () => { vozOn ? apagarVozKusuri() : prenderVozKusuri(); };
$('vozForm').onsubmit = ev => { ev.preventDefault(); decirKusuri($('vozTexto').value); $('vozTexto').value = ''; };
if (!enEstePC) $('vozKusuri').style.display = 'none';
if (MODO_LLAMADA) new EventSource('/voz/boca').onmessage = ev => {
  if (ev.data === 'personaje' || ev.data === 'ajustes') seguirPersonaje(ev.data);
  else if (ev.data.startsWith('cerca:')) {
    const cerca = ev.data === 'cerca:1';
    if (cerca !== deCerca) $('cerca').click();
  } else nivelKusuri = Number(ev.data) || 0;
};
if (enEstePC && !MODO_LLAMADA) verLlamada();
$('cerrarGuia').onclick = () => $('guia').close();
/* ---------- Mis personajes ---------- */
const HUESOS_NECESARIOS = { hips: 'cadera', spine: 'columna', head: 'cabeza', leftUpperArm: 'brazo izquierdo', leftLowerArm: 'antebrazo izquierdo', leftHand: 'mano izquierda', rightUpperArm: 'brazo derecho', rightLowerArm: 'antebrazo derecho', rightHand: 'mano derecha', leftUpperLeg: 'pierna izquierda', leftLowerLeg: 'rodilla izquierda', leftFoot: 'pie izquierdo', rightUpperLeg: 'pierna derecha', rightLowerLeg: 'rodilla derecha', rightFoot: 'pie derecho' };
const urlDe = id => (id === 'original' ? 'personaje.vrm' : '/personajes/archivo/' + id + '.vrm');
function ponerRevision(clase, texto) { revisionPersonaje = { clase, texto }; if ($('panel').classList.contains('ver') && pestana === 'Personajes') dibujarPanel(); }

// Lee solo el encabezado del archivo: así se revisa sin cargar todo el personaje
async function revisarEsqueleto(archivo) {
  if (!/\.vrm$/i.test(archivo.name)) return `«${archivo.name}» no es un personaje .vrm. En VRoid Studio usa «Exportar» y elige VRM.`;
  const cabeza = new DataView(await archivo.slice(0, 20).arrayBuffer());
  if (cabeza.byteLength < 20 || cabeza.getUint32(0, true) !== 0x46546c67 || cabeza.getUint32(16, true) !== 0x4e4f534a) return 'Ese archivo no es un personaje .vrm válido.';
  let datos;
  try { datos = JSON.parse(await archivo.slice(20, 20 + cabeza.getUint32(12, true)).text()); } catch (e) { return 'El archivo está dañado: no pude leer el personaje.'; }
  const ext = datos.extensions || {};
  let huesos = null;
  if (ext.VRMC_vrm && ext.VRMC_vrm.humanoid) huesos = Object.keys(ext.VRMC_vrm.humanoid.humanBones || {});
  else if (ext.VRM && ext.VRM.humanoid) huesos = (ext.VRM.humanoid.humanBones || []).map(h => h.bone);
  if (!huesos) return 'Ese archivo no trae esqueleto de personaje VRM.';
  const faltan = Object.keys(HUESOS_NECESARIOS).filter(h => !huesos.includes(h)).map(h => HUESOS_NECESARIOS[h]);
  return faltan.length ? `A este personaje le faltan huesos (${faltan.join(', ')}). No lo agregué para que no se mueva mal.` : '';
}
async function subirPersonaje(archivo) {
  if (modoWeb) { ponerRevision('mal', 'Para subir tus personajes usa la aplicación para PC.'); return; }
  const problema = await revisarEsqueleto(archivo).catch(() => 'No pude leer ese archivo.');
  if (problema) { ponerRevision('mal', problema); aviso(''); return; }
  ponerRevision('espera', 'Guardando personaje…');
  try {
    const r = await fetch('/personajes/subir?nombre=' + encodeURIComponent(archivo.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    const anterior = misPersonajes.actual;
    misPersonajes = d.lista;
    if (await elegirPersonaje(d.id)) ponerRevision('bien', '✔ Esqueleto revisado: puede bailar y copiar tus movimientos. Quedó guardado también para las llamadas.');
    else {
      await postJSON('/personajes/quitar', { id: d.id }).catch(() => {});
      misPersonajes.lista = misPersonajes.lista.filter(x => x.id !== d.id);
      await elegirPersonaje(anterior);
      ponerRevision('mal', 'No pude abrir ese personaje, así que no lo agregué.');
    }
  } catch (e) { ponerRevision('mal', e.message || 'No pude guardar el personaje.'); }
}
async function elegirPersonaje(id) {
  const p = misPersonajes.lista.find(x => x.id === id); if (!p) return false;
  clearTimeout(esperaAjustes);
  ajustes = unirAjustes(p.ajustes); misPersonajes.actual = id;
  ponerRevision('', '');
  const bien = await cargar(urlDe(id), p.nombre);
  if (bien) await postJSON('/personajes/elegir', { id }).catch(() => {});
  verBotonZorra();
  if ($('panel').classList.contains('ver')) dibujarPanel();
  return bien;
}
async function quitarPersonaje(id) {
  const p = misPersonajes.lista.find(x => x.id === id);
  if (!p || !confirm(`¿Quitar «${p.nombre}» de la lista? Tu archivo original no se borra.`)) return;
  const eraActual = misPersonajes.actual === id;
  const r = await postJSON('/personajes/quitar', { id }).catch(() => null);
  if (!r || !r.ok) { ponerRevision('mal', 'No pude quitar ese personaje.'); return; }
  misPersonajes = await r.json();
  if (eraActual) await elegirPersonaje('original'); else dibujarPanel();
}
function guardarFotoSiFalta() {
  const p = misPersonajes.lista.find(x => x.id === misPersonajes.actual);
  if (!p || p.foto) return;
  const c = document.createElement('canvas'); c.width = 116; c.height = 156;
  const lado = Math.min(lienzo.width, lienzo.height * 116 / 156), alto = lado * 156 / 116;
  c.getContext('2d').drawImage(lienzo, (lienzo.width - lado) / 2, (lienzo.height - alto) / 2, lado, alto, 0, 0, 116, 156);
  p.foto = c.toDataURL('image/jpeg', 0.75);
  postJSON('/personajes/foto', { id: p.id, foto: p.foto }).catch(() => {});
  if ($('panel').classList.contains('ver') && pestana === 'Personajes') dibujarPanel();
}
async function leerPersonajes() {
  const r = await fetch('/personajes/lista');
  if (!r.ok) throw new Error('sin lista');
  misPersonajes = await r.json();
}
async function iniciarPersonaje() {
  try { await leerPersonajes(); } catch (e) { console.warn(e); }
  const p = misPersonajes.lista.find(x => x.id === misPersonajes.actual) || misPersonajes.lista[0];
  misPersonajes.actual = p.id;
  // Los ajustes que ya tenías en esta computadora pasan al personaje original
  if (p.id === 'original' && !p.ajustes && !MODO_LLAMADA) {
    try { const viejo = JSON.parse(localStorage.getItem('personajeAjustes')); if (viejo && viejo.cuerpo) { p.ajustes = viejo; postJSON('/personajes/ajustes', { id: p.id, ajustes: viejo }).catch(() => {}); } } catch (e) {}
  }
  ajustes = unirAjustes(p.ajustes);
  const bien = await cargar(urlDe(p.id), p.nombre);
  if (!bien && p.id !== 'original') await elegirPersonaje('original');
}
// La ventana de la llamada sigue lo que se elige en la principal
async function seguirPersonaje(tipo) {
  const antes = misPersonajes.actual;
  await leerPersonajes().catch(() => {});
  const p = misPersonajes.lista.find(x => x.id === misPersonajes.actual); if (!p) return;
  ajustes = unirAjustes(p.ajustes);
  if (tipo === 'personaje' && p.id !== antes) await cargar(urlDe(p.id), p.nombre);
  else if (vrm) { ponerCuerpo(); ponerColores(); medirDespues(); }
}

// Arrastrar y soltar un .vrm sobre la página
window.addEventListener('dragover', e => { e.preventDefault(); $('soltar').style.display = 'flex'; });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('soltar').style.display = 'none'; });
window.addEventListener('drop', e => {
  e.preventDefault(); $('soltar').style.display = 'none';
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (!$('panel').classList.contains('ver')) $('personaje').click();
  pestana = 'Personajes'; subirPersonaje(f);
});

/* ---------- Vista YouTuber (de cerca) y voz ---------- */
let deCerca = false, moviendoCamara = 0;
const mirar = new THREE.Vector3(), desde = new THREE.Vector3();
function moverCamara() {
  if (!vrm || moviendoCamara <= 0) return;
  moviendoCamara--;
  if (deCerca) {
    const cabeza = hueso('head').getWorldPosition(new THREE.Vector3());
    mirar.set(0, cabeza.y - 0.08, 0); desde.set(0, cabeza.y - 0.02, 1.45);
  } else { mirar.set(0, 0.72, 0); desde.set(0, 1.0, 4.6); }
  controles.target.lerp(mirar, 0.12); camara.position.lerp(desde, 0.12); controles.update();
}
$('cerca').onclick = () => {
  deCerca = !deCerca; moviendoCamara = 60;
  $('cerca').classList.toggle('on', deCerca);
  if (!MODO_LLAMADA && $('llamadas').classList.contains('on')) postJSON('/llamadas/vista', { cerca: deCerca }).catch(() => {});
};
let analizador = null, datosVoz = null, nivelKusuri = 0;
function volumenVoz() {
  if (!analizador) return nivelKusuri;
  analizador.getByteTimeDomainData(datosVoz);
  let s = 0; for (const v of datosVoz) s += (v - 128) * (v - 128);
  const rms = Math.sqrt(s / datosVoz.length) / 128;
  return Math.max(nivelKusuri, Math.max(0, Math.min(1, (rms - 0.02) * 8)));
}
$('voz').onclick = async () => {
  if (analizador) { analizador = null; $('voz').classList.remove('on'); return; }
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext(); analizador = ctx.createAnalyser(); analizador.fftSize = 1024;
    datosVoz = new Uint8Array(analizador.fftSize); ctx.createMediaStreamSource(flujo).connect(analizador);
    $('voz').classList.add('on');
  } catch (e) { aviso('No pude abrir el micrófono: revisa el permiso del navegador'); }
};

/* ---------- Reposo natural (cuando la cámara no te ve) ----------
   Respira, se balancea y mira alrededor; cada tanto hace sola una animación de VRoid
   (saludo, paz y amor, giro, pose…). Animaciones: pixiv Inc. VRoid Project */
const ANIMACIONES = ['VRMA_02', 'VRMA_03', 'VRMA_06', 'VRMA_01', 'VRMA_05', 'VRMA_07', 'VRMA_04'];
let datosAnim = null, mezclador = null, clips = [], accion = null, proximaAnim = 0, finAnim = 0;
let pesoReposo = 0, ultimaVezVisto = -1e9;
async function prepararAnimaciones() {
  if (!datosAnim) {
    datosAnim = Promise.all(ANIMACIONES.map(n => cargador.loadAsync('animaciones/' + n + '.vrma')
      .then(g => g.userData.vrmAnimations && g.userData.vrmAnimations[0]).catch(e => { console.warn(n, e); return null; })));
  }
  const para = vrm, lista = await datosAnim;
  if (vrm !== para) return;
  mezclador = new THREE.AnimationMixer(vrm.scene);
  clips = lista.filter(Boolean).map(a => createVRMAnimationClip(a, vrm));
  accion = null; proximaAnim = 0;
}
const HUESOS_REPOSO = () => Object.keys(vrm.humanoid.humanBones).map(n => [n, hueso(n)]).filter(([, h]) => h);
function poseReposo(ahora) {
  const t = ahora / 1000, r = (n, x, y, z) => { const h = hueso(n); if (h) h.quaternion.setFromEuler(new THREE.Euler(x, y, z)); };
  const respira = Math.sin(t * 2 * Math.PI / 4.2), balanceo = Math.sin(t * 2 * Math.PI / 7);
  for (const [n] of HUESOS_REPOSO()) hueso(n).quaternion.identity();
  r('hips', 0, balanceo * 0.05, balanceo * 0.025);
  r('spine', respira * 0.012, 0, -balanceo * 0.02);
  r('chest', respira * 0.025, 0, 0);
  r('neck', 0, Math.sin(t * 0.37) * 0.08, 0);
  r('head', Math.sin(t * 0.23) * 0.06, Math.sin(t * 0.31) * 0.18, Math.sin(t * 0.19) * 0.04);
  // brazos relajados al costado, con un leve vaivén
  r('leftUpperArm', 0.05, 0, -1.2 - respira * 0.02); r('rightUpperArm', 0.05, 0, 1.2 + respira * 0.02);
  r('leftLowerArm', 0, -0.25, 0); r('rightLowerArm', 0, 0.25, 0);
  for (const lado of ['left', 'right']) for (const d of ['Index', 'Middle', 'Ring', 'Little']) for (const f of ['Proximal', 'Intermediate'])
    r(lado + d + f, 0, 0, (lado === 'left' ? -1 : 1) * 0.3);
  // una pierna un poco suelta (el peso en la otra), cambia cada tanto
  const peso = Math.sin(t * 2 * Math.PI / 14) > 0 ? 1 : -1;
  r(peso > 0 ? 'rightUpperLeg' : 'leftUpperLeg', -0.08, 0, 0); r(peso > 0 ? 'rightLowerLeg' : 'leftLowerLeg', 0.16, 0, 0);
  const h = hueso('hips'); if (h) { h.position.copy(reposo.caderaPos); h.position.y += -0.005 + respira * 0.002; }
}
function reposar(ahora, dt) {
  poseReposo(ahora);
  if (!mezclador || !clips.length) return;
  // cada 7 a 12 segundos, una animación de VRoid mezclada suave sobre el reposo
  if (!accion && ahora > proximaAnim) {
    if (proximaAnim) {
      const clip = clips[Math.floor(Math.random() * clips.length)];
      mezclador.stopAllAction();
      accion = mezclador.clipAction(clip); accion.reset(); accion.setLoop(THREE.LoopOnce, 1); accion.clampWhenFinished = true; accion.play();
      finAnim = ahora + clip.duration * 1000;
    } else proximaAnim = ahora + 4000;
  }
  if (!accion) return;
  const base = HUESOS_REPOSO().map(([n, h]) => [h, h.quaternion.clone(), h.position.clone()]);
  mezclador.update(dt);
  const falta = (finAnim - ahora) / 1000, dentro = (accion.time || 0);
  const w = Math.max(0, Math.min(1, dentro / 0.5, falta / 0.6));
  for (const [h, q, p] of base) { const qa = h.quaternion.clone(); h.quaternion.copy(q).slerp(qa, w); if (h === hueso('hips')) h.position.lerp(p, 1 - w); }
  if (falta <= 0) { accion.stop(); accion = null; proximaAnim = ahora + 7000 + Math.random() * 5000; }
}
// En la cámara: si no te ve por 1,5 segundos, pasa al reposo poco a poco (y vuelve igual de suave)
function mezclarReposo(ahora, dt) {
  if (ultimaPose) ultimaVezVisto = ahora;
  const quiere = ahora - ultimaVezVisto > 1500 ? 1 : 0;
  pesoReposo += Math.sign(quiere - pesoReposo) * Math.min(Math.abs(quiere - pesoReposo), dt / 0.6);
  if (pesoReposo <= 0) { if (accion) { accion.stop(); accion = null; } proximaAnim = 0; return; }
  const copiado = HUESOS_REPOSO().map(([n, h]) => [h, h.quaternion.clone(), h.position.clone()]);
  reposar(ahora, dt);
  const s = pesoReposo * pesoReposo * (3 - 2 * pesoReposo);
  for (const [h, q, p] of copiado) { h.quaternion.copy(q.slerp(h.quaternion, s)); h.position.copy(p.lerp(h.position, s)); }
  window.__reposo = pesoReposo;
}

/* ---------- Botón Zorra: cambia entre las dos zorras (se va la que está y entra la otra) ---------- */
let cambiandoZorra = false;
const esZorra = x => /zorr|shibahu/i.test(x.nombre);
const idZorra = () => { const z = misPersonajes.lista.filter(esZorra).find(x => x.id !== misPersonajes.actual); return z && z.id; };
function verBotonZorra() { const b = $('invocar'); if (b) b.style.display = misPersonajes.lista.filter(esZorra).length > 1 ? '' : 'none'; }
async function invocarZorra() {
  const id = idZorra(); if (!id || cambiandoZorra) return;
  cambiandoZorra = true; $('invocar').classList.add('on');
  try { await elegirPersonaje(id); } finally { cambiandoZorra = false; $('invocar').classList.remove('on'); verBotonZorra(); }
}

/* ---------- Los botones se esconden mientras bailas (vuelven al mover el mouse o tocar) ---------- */
let esperaEsconder = 0;
function mostrarBotones() {
  document.body.classList.remove('escondido'); clearTimeout(esperaEsconder);
  esperaEsconder = setTimeout(() => {
    const ocupado = $('panel').classList.contains('ver') || $('cajaVoz').classList.contains('ver') || document.querySelector('dialog[open]');
    if (!ocupado) document.body.classList.add('escondido');
  }, 3000);
}
for (const ev of ['mousemove', 'pointerdown', 'keydown', 'touchstart']) addEventListener(ev, mostrarBotones, { passive: true });
mostrarBotones();

/* ---------- Bucle ---------- */
const reloj = new THREE.Clock();
function cuadro(ahora) {
  requestAnimationFrame(cuadro);
  const dt = Math.min(0.05, reloj.getDelta());
  if (vrm) {
    if (modo === 'bailar') bailar(ahora); else { seguir(ahora); mezclarReposo(ahora, dt); }
    // Si solo está el micrófono (sin cara en la cámara), la boca igual habla
    if ((analizador || nivelKusuri > 0) && (modo === 'bailar' || !ultimaCara)) gesto('aa', volumenVoz());
    moverCamara();
    vrm.update(dt);
  }
  tocarRitmo();
  render.render(escena, camara);
}
requestAnimationFrame(cuadro);
iniciarPersonaje().then(verBotonZorra);
$('invocar').onclick = invocarZorra;
window.__demo = { get vrm() { return vrm; } };
