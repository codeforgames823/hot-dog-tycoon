// game-3d.js — First-person 3D overworld (Three.js)
// ----------------------------------------------------------------------
// Replaces the side-scroller overworld with a real 3D world the player
// walks around in. Reads/writes the existing global `state`, `BUILDING_DEFS`,
// `keys`, and bridges into the existing CSS-3D `enterInterior(id)` for
// building interiors (which are unchanged).
// ----------------------------------------------------------------------

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// Bridge-in globals from game.js (regular script). They're attached to window
// in game.js's BOOT block.
const state = window.state;
const BUILDING_DEFS = window.BUILDING_DEFS;
const WORLD_WIDTH = window.WORLD_WIDTH;
const keys = window.keys;
const enterInterior = window.enterInterior;

// ---------- CONFIG ----------
const SCALE = 0.06;                  // 1 game pixel = 0.06 meters
const WORLD_LEN = WORLD_WIDTH * SCALE; // long axis (X) of the city
const ROAD_WIDTH = 12;
const SIDEWALK_WIDTH = 4;
const GRASS_DEPTH = 80;              // how far the world extends in Z each side
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.6;
const PLAYER_SPEED = 6.5;
const PLAYER_RUN_MULT = 1.6;
const ENTER_RANGE = 6;               // meters from a building's door to enter

// ---------- STATE ----------
const fpv = {
  active: false,
  initialized: false,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  buildings: [],     // [{ def, mesh, doorPos: Vector3, halfW, halfD }]
  npcs: [],          // [{ mesh, speed, dir }]
  sun: null,
  ambient: null,
  hemi: null,
  skyMat: null,
  fogColor: new THREE.Color(0x87ceeb),
  velocity: new THREE.Vector3(),
  nearestBuilding: null,
  enterPromptEl: null,
  hintEl: null,
  lockOverlayEl: null,
  crosshairEl: null,
  canvas: null,
  windowsTexCache: new Map(), // building id -> { day: Texture, night: Texture }
  litMaterials: [],            // materials whose emissive we toggle for night
};

// Expose so game.js can tell us when to start/stop and what to do per frame.
window.fpvOverworld = {
  init,
  show,
  hide,
  updateFrame,
  isActive: () => fpv.active,
  enterNearest,    // for game.js E-key bridge
  hasNearest: () => !!fpv.nearestBuilding,
};

// ---------- INIT ----------
function init() {
  if (fpv.initialized) return;
  fpv.initialized = true;

  fpv.canvas = document.getElementById('three-canvas');
  fpv.crosshairEl = document.getElementById('crosshair');
  fpv.hintEl = document.getElementById('fpvHint');
  fpv.lockOverlayEl = document.getElementById('lockOverlay');

  // Floating "Press E to enter ..." pill
  fpv.enterPromptEl = document.createElement('div');
  fpv.enterPromptEl.className = 'fpv-enter-prompt hidden';
  fpv.enterPromptEl.innerHTML = 'Press <kbd>E</kbd> to enter';
  document.getElementById('world').appendChild(fpv.enterPromptEl);

  fpv.scene = new THREE.Scene();
  fpv.scene.background = new THREE.Color(0x87ceeb);
  fpv.scene.fog = new THREE.Fog(0x87ceeb, 30, 280);

  fpv.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 600);
  fpv.camera.position.set(20, PLAYER_HEIGHT, 0);

  fpv.renderer = new THREE.WebGLRenderer({ canvas: fpv.canvas, antialias: true });
  fpv.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  resizeRenderer();

  // Lights
  fpv.ambient = new THREE.AmbientLight(0xffffff, 0.45);
  fpv.scene.add(fpv.ambient);

  fpv.hemi = new THREE.HemisphereLight(0xa6cfff, 0x4a7a3a, 0.55);
  fpv.scene.add(fpv.hemi);

  fpv.sun = new THREE.DirectionalLight(0xffffff, 1.1);
  fpv.sun.position.set(60, 120, 30);
  fpv.scene.add(fpv.sun);

  // Sky dome (large back-side sphere)
  const skyGeom = new THREE.SphereGeometry(450, 32, 16);
  fpv.skyMat = new THREE.MeshBasicMaterial({
    color: 0x87ceeb,
    side: THREE.BackSide,
    fog: false,
  });
  fpv.scene.add(new THREE.Mesh(skyGeom, fpv.skyMat));

  buildGround();
  buildBuildings();
  buildNpcs();

  // Pointer lock controls
  fpv.controls = new PointerLockControls(fpv.camera, document.body);
  fpv.scene.add(fpv.controls.object);

  fpv.controls.addEventListener('lock', () => {
    fpv.lockOverlayEl.classList.add('hidden');
    fpv.hintEl.classList.remove('hidden');
  });
  fpv.controls.addEventListener('unlock', () => {
    if (fpv.active && !state.interiorBuildingId) {
      fpv.lockOverlayEl.classList.remove('hidden');
    }
    fpv.hintEl.classList.add('hidden');
  });

  fpv.lockOverlayEl.addEventListener('click', () => {
    if (fpv.active && !state.interiorBuildingId) fpv.controls.lock();
  });
  fpv.canvas.addEventListener('click', () => {
    if (fpv.active && !state.interiorBuildingId && !fpv.controls.isLocked) {
      fpv.controls.lock();
    }
  });

  // E to enter is handled by game.js; we expose enterNearest()

  window.addEventListener('resize', resizeRenderer);
}

function resizeRenderer() {
  if (!fpv.renderer) return;
  const w = window.innerWidth;
  // Reserve top HUD bar (~80px); the canvas fills the rest of .world
  const worldEl = document.getElementById('world');
  const h = worldEl ? worldEl.clientHeight : window.innerHeight - 80;
  fpv.renderer.setSize(w, h, false);
  fpv.camera.aspect = w / h;
  fpv.camera.updateProjectionMatrix();
}

// ---------- WORLD GEOMETRY ----------
function buildGround() {
  // Grass: a wide plane covering the entire world, behind/under everything
  const grassGeom = new THREE.PlaneGeometry(WORLD_LEN + 100, GRASS_DEPTH * 2 + 60);
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x5a8a3a });
  const grass = new THREE.Mesh(grassGeom, grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(WORLD_LEN / 2, 0, 0);
  fpv.scene.add(grass);

  // Road (asphalt)
  const roadGeom = new THREE.PlaneGeometry(WORLD_LEN, ROAD_WIDTH);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const road = new THREE.Mesh(roadGeom, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(WORLD_LEN / 2, 0.02, 0);
  fpv.scene.add(road);

  // Center yellow dashes (just a long thin strip, simple)
  const dashCount = Math.floor(WORLD_LEN / 6);
  const dashGeom = new THREE.PlaneGeometry(3, 0.3);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
  for (let i = 0; i < dashCount; i++) {
    const d = new THREE.Mesh(dashGeom, dashMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(i * 6 + 3, 0.04, 0);
    fpv.scene.add(d);
  }

  // Two sidewalks (one on each side of road)
  for (const sign of [-1, +1]) {
    const swGeom = new THREE.PlaneGeometry(WORLD_LEN, SIDEWALK_WIDTH);
    const swMat = new THREE.MeshLambertMaterial({ color: 0xb6b6b6 });
    const sw = new THREE.Mesh(swGeom, swMat);
    sw.rotation.x = -Math.PI / 2;
    sw.position.set(WORLD_LEN / 2, 0.03, sign * (ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2));
    fpv.scene.add(sw);
  }
}

function buildBuildings() {
  // Place buildings on alternating sides of the road for a real street feel.
  // Even index -> north side (z<0), odd -> south side (z>0).
  BUILDING_DEFS.forEach((def, i) => {
    const w = (140 + def.windows[0] * 8) * SCALE;
    const h = def.height * SCALE;
    const d = ((def.depth || 90) + 30) * SCALE; // a bit deeper for visual mass
    const x = def.x * SCALE + w / 2;
    const sideSign = (i % 2 === 0) ? -1 : +1;
    const sideOffset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH + d / 2 + 0.5;
    const z = sideSign * sideOffset;

    const tex = makeBuildingTexture(def, false);
    const litTex = makeBuildingTexture(def, true);

    // Material per face: front/back use the windows texture; sides use it too;
    // top = roof color; bottom = unseen (just dark).
    const wallMat = new THREE.MeshLambertMaterial({
      map: tex,
      emissiveMap: litTex,
      emissive: new THREE.Color(0x000000), // toggled at night via emissiveIntensity
    });
    const roofMat = new THREE.MeshLambertMaterial({ color: shadeHex(def.color, 1.15) });
    const bottomMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

    // BoxGeometry materials order: +X,-X,+Y,-Y,+Z,-Z
    const mats = [
      wallMat, // +X (right side)
      wallMat, // -X (left side)
      roofMat, // +Y (top)
      bottomMat, // -Y (bottom)
      wallMat, // +Z (front, faces +Z direction)
      wallMat, // -Z (back)
    ];

    const geom = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geom, mats);
    mesh.position.set(x, h / 2, z);
    fpv.scene.add(mesh);

    // Door: a small dark plane on the road-facing side
    const doorH = Math.min(2.4, h * 0.35);
    const doorW = 1.6;
    const doorGeom = new THREE.PlaneGeometry(doorW, doorH);
    const doorMat = new THREE.MeshBasicMaterial({ color: 0x2a1a08 });
    const door = new THREE.Mesh(doorGeom, doorMat);
    const facingZ = -sideSign; // door faces road
    door.position.set(x, doorH / 2 + 0.01, z + facingZ * (d / 2 + 0.02));
    door.rotation.y = sideSign === -1 ? Math.PI : 0; // face the road
    fpv.scene.add(door);

    // Floating name banner above door (always faces camera via Sprite)
    const nameSpr = makeTextSprite(def.icon + ' ' + def.name);
    nameSpr.position.set(x, h + 1.6, z + facingZ * (d / 2 + 0.05));
    nameSpr.visible = false;
    fpv.scene.add(nameSpr);

    fpv.buildings.push({
      def,
      mesh,
      doorPos: new THREE.Vector3(x, 0, z + facingZ * (d / 2 + 0.5)),
      enterPos: new THREE.Vector3(x, PLAYER_HEIGHT, z + facingZ * (d / 2 + 1.2)),
      halfW: w / 2,
      halfD: d / 2,
      x, z, w, d, h,
      sideSign,
      nameSprite: nameSpr,
      wallMat,
    });

    fpv.litMaterials.push(wallMat);
  });
}

// Procedural texture: facade with windows + door for a building.
function makeBuildingTexture(def, lit) {
  const cw = 256;
  const ch = Math.max(128, Math.floor(256 * def.height / 200));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');

  // Wall background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, shadeHex(def.color, 1.1));
  grad.addColorStop(1, shadeHex(def.color, 0.65));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  // Windows
  const cols = Math.max(1, def.windows[0]);
  const rows = Math.max(1, def.windows[1]);
  if (def.windows[0] > 0) {
    const padX = 16;
    const usableW = cw - padX * 2;
    const winW = (usableW / cols) * 0.7;
    const gapX = (usableW - winW * cols) / (cols + 1);
    const padTop = 24;
    const padBot = 50;
    const usableH = ch - padTop - padBot;
    const winH = (usableH / rows) * 0.7;
    const gapY = (usableH - winH * rows) / (rows + 1);

    for (let r = 0; r < rows; r++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = padX + gapX + cx * (winW + gapX);
        const y = padTop + gapY + r * (winH + gapY);
        const isLit = lit ? Math.random() > 0.25 : false;
        if (lit) {
          ctx.fillStyle = isLit ? '#ffd23a' : '#1a1208';
          // soft glow background
          if (isLit) {
            ctx.fillStyle = '#ffe680';
            ctx.fillRect(x - 2, y - 2, winW + 4, winH + 4);
            ctx.fillStyle = '#ffd23a';
          }
        } else {
          ctx.fillStyle = '#3a2a1a';
        }
        ctx.fillRect(x, y, winW, winH);
        // window cross
        ctx.strokeStyle = lit ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + winW / 2, y); ctx.lineTo(x + winW / 2, y + winH);
        ctx.moveTo(x, y + winH / 2); ctx.lineTo(x + winW, y + winH / 2);
        ctx.stroke();
      }
    }
  }

  // Door (only on the wall facing the road; here baked into all sides for simplicity)
  const dw = 36, dh = 50;
  const dx = (cw - dw) / 2;
  const dy = ch - dh - 4;
  const dgrad = ctx.createLinearGradient(dx, dy, dx, dy + dh);
  dgrad.addColorStop(0, '#5a3a1a'); dgrad.addColorStop(1, '#2a1808');
  ctx.fillStyle = dgrad;
  ctx.fillRect(dx, dy, dw, dh);
  ctx.strokeStyle = '#1a1208'; ctx.lineWidth = 2; ctx.strokeRect(dx, dy, dw, dh);
  // doorknob
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  ctx.arc(dx + dw - 8, dy + dh / 2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Building icon up top
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.icon, cw / 2, 28);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function makeTextSprite(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,20,20,0.85)';
  roundRect(ctx, 16, 16, 480, 64, 16);
  ctx.fill();
  ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 2;
  roundRect(ctx, 16, 16, 480, 64, 16);
  ctx.stroke();
  ctx.fillStyle = '#ffd23a';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(8, 1.5, 1);
  return spr;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ---------- NPCS ----------
function buildNpcs() {
  // Cheap billboarded emoji sprites
  const emojis = ['🚶', '🚶‍♀️', '🐕', '🚴', '🐩', '🤵', '👮'];
  for (let i = 0; i < 22; i++) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = '110px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emojis[i % emojis.length], 64, 80);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(2.2, 2.2, 1);
    const sideSign = Math.random() < 0.5 ? -1 : 1;
    const z = sideSign * (ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2);
    const x = Math.random() * WORLD_LEN;
    spr.position.set(x, 1.1, z);
    fpv.scene.add(spr);
    fpv.npcs.push({
      mesh: spr,
      speed: (0.6 + Math.random() * 1.2) * (Math.random() < 0.5 ? -1 : 1),
      z,
    });
  }
}

// ---------- LIFECYCLE ----------
function show() {
  if (!fpv.initialized) init();
  fpv.active = true;
  document.getElementById('world').classList.add('fpv');
  fpv.canvas.classList.remove('hidden');
  fpv.crosshairEl.classList.remove('hidden');
  // Spawn at the apartment door (start of the strip)
  const home = fpv.buildings.find(b => b.def.id === 'home') || fpv.buildings[0];
  fpv.controls.object.position.set(home.enterPos.x, PLAYER_HEIGHT, home.enterPos.z + (home.sideSign === -1 ? 1.5 : -1.5));
  fpv.controls.object.rotation.y = home.sideSign === -1 ? 0 : Math.PI;
  // Show click-to-play overlay until user locks pointer
  fpv.lockOverlayEl.classList.remove('hidden');
  fpv.hintEl.classList.add('hidden');
  resizeRenderer();
  syncWorldX();
}

function hide() {
  fpv.active = false;
  document.getElementById('world').classList.remove('fpv');
  fpv.canvas.classList.add('hidden');
  fpv.crosshairEl.classList.add('hidden');
  fpv.hintEl.classList.add('hidden');
  fpv.lockOverlayEl.classList.add('hidden');
  fpv.enterPromptEl.classList.add('hidden');
  if (fpv.controls && fpv.controls.isLocked) fpv.controls.unlock();
}

// Called from game.js's loop each frame, after game.js update/render.
function updateFrame(dt) {
  if (!fpv.active) return;
  if (state.interiorBuildingId) {
    // We're inside a building — pause 3D rendering, hide chrome.
    fpv.canvas.classList.add('hidden');
    fpv.crosshairEl.classList.add('hidden');
    fpv.hintEl.classList.add('hidden');
    fpv.enterPromptEl.classList.add('hidden');
    fpv.lockOverlayEl.classList.add('hidden');
    if (fpv.controls.isLocked) fpv.controls.unlock();
    return;
  }
  // Coming back from interior — re-show
  if (fpv.canvas.classList.contains('hidden')) {
    fpv.canvas.classList.remove('hidden');
    fpv.crosshairEl.classList.remove('hidden');
    fpv.lockOverlayEl.classList.remove('hidden');
    syncWorldX();
  }

  movePlayer(dt);
  updateNpcs(dt);
  updateNearest();
  updateDayNight();

  fpv.renderer.render(fpv.scene, fpv.camera);

  // Sync horizontal position back to game.js (so saves & HUD match)
  syncWorldX();
}

// ---------- MOVEMENT ----------
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
function movePlayer(dt) {
  if (!fpv.controls.isLocked) return;

  // Read keys[] global maintained by game.js
  let fwd = 0, right = 0;
  if (keys['w'] || keys['arrowup']) fwd += 1;
  if (keys['s'] || keys['arrowdown']) fwd -= 1;
  if (keys['d'] || keys['arrowright']) right += 1;
  if (keys['a'] || keys['arrowleft']) right -= 1;
  const running = !!keys['shift'];
  const speed = PLAYER_SPEED * (running ? PLAYER_RUN_MULT : 1);

  if (fwd === 0 && right === 0) return;

  // Camera basis vectors flattened to ground plane
  fpv.camera.getWorldDirection(tmpForward);
  tmpForward.y = 0; tmpForward.normalize();
  tmpRight.copy(tmpForward).cross(fpv.camera.up).normalize();

  const dx = (tmpForward.x * fwd + tmpRight.x * right) * speed * dt;
  const dz = (tmpForward.z * fwd + tmpRight.z * right) * speed * dt;

  const pos = fpv.controls.object.position;
  // Try X then Z separately so we slide along walls instead of getting stuck
  tryMoveAxis(pos, dx, 0);
  tryMoveAxis(pos, 0, dz);

  // Clamp to world bounds
  pos.x = Math.max(2, Math.min(WORLD_LEN - 2, pos.x));
  pos.z = Math.max(-GRASS_DEPTH + 2, Math.min(GRASS_DEPTH - 2, pos.z));
  pos.y = PLAYER_HEIGHT;
}

function tryMoveAxis(pos, dx, dz) {
  const nx = pos.x + dx;
  const nz = pos.z + dz;
  if (collidesAt(nx, nz)) return false;
  pos.x = nx; pos.z = nz;
  return true;
}

function collidesAt(x, z) {
  // AABB vs every building (cheap, n=24)
  for (const b of fpv.buildings) {
    const localX = x - b.x;
    const localZ = z - b.z;
    if (Math.abs(localX) < b.halfW + PLAYER_RADIUS &&
        Math.abs(localZ) < b.halfD + PLAYER_RADIUS) {
      return true;
    }
  }
  return false;
}

// ---------- NPCS ----------
function updateNpcs(dt) {
  for (const n of fpv.npcs) {
    n.mesh.position.x += n.speed * dt;
    if (n.mesh.position.x > WORLD_LEN + 4) n.mesh.position.x = -4;
    if (n.mesh.position.x < -4) n.mesh.position.x = WORLD_LEN + 4;
  }
}

// ---------- NEAREST BUILDING / ENTER ----------
function updateNearest() {
  const pos = fpv.controls.object.position;
  let best = null;
  let bestDist = ENTER_RANGE;
  for (const b of fpv.buildings) {
    const d = Math.hypot(pos.x - b.enterPos.x, pos.z - b.enterPos.z);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  if (best !== fpv.nearestBuilding) {
    if (fpv.nearestBuilding) fpv.nearestBuilding.nameSprite.visible = false;
    fpv.nearestBuilding = best;
    if (best) best.nameSprite.visible = true;
  }
  if (best) {
    fpv.enterPromptEl.innerHTML = `Press <kbd>E</kbd> to enter <b>${best.def.icon} ${best.def.name}</b>`;
    fpv.enterPromptEl.classList.remove('hidden');
  } else {
    fpv.enterPromptEl.classList.add('hidden');
  }
}

function enterNearest() {
  if (!fpv.nearestBuilding) return false;
  enterInterior(fpv.nearestBuilding.def.id);
  return true;
}

// ---------- DAY/NIGHT ----------
function updateDayNight() {
  // state.timeMin runs 0..1440 (game minutes since midnight). 6=dawn, 18=dusk.
  const hour = state.timeMin / 60;
  // Smooth t: 1 = full day, 0 = full night
  let t;
  if (hour < 5) t = 0;
  else if (hour < 7) t = (hour - 5) / 2;
  else if (hour < 18) t = 1;
  else if (hour < 20) t = 1 - (hour - 18) / 2;
  else t = 0;

  const day = new THREE.Color(0x87ceeb);
  const dusk = new THREE.Color(0xff8a4a);
  const night = new THREE.Color(0x0e1230);
  let sky;
  if (hour >= 17 && hour < 20) {
    // dusk transition
    const k = (hour - 17) / 3;
    sky = day.clone().lerp(dusk, Math.min(1, k * 1.5)).lerp(night, Math.max(0, k - 0.5) * 2);
  } else if (hour >= 5 && hour < 7) {
    // dawn
    const k = (hour - 5) / 2;
    sky = night.clone().lerp(dusk, Math.min(1, k * 1.5)).lerp(day, Math.max(0, k - 0.5) * 2);
  } else if (hour >= 7 && hour < 17) {
    sky = day;
  } else {
    sky = night;
  }

  fpv.skyMat.color.copy(sky);
  fpv.scene.background = sky;
  fpv.scene.fog.color.copy(sky);

  // Sun intensity follows t
  fpv.sun.intensity = 0.25 + t * 1.0;
  fpv.ambient.intensity = 0.25 + t * 0.4;
  fpv.hemi.intensity = 0.3 + t * 0.5;

  // Window emissive intensity ramps up at night
  const emissive = 1 - t;
  for (const m of fpv.litMaterials) {
    m.emissive.setRGB(emissive, emissive, emissive);
    m.emissiveIntensity = 1.0;
  }
}

// ---------- HELPERS ----------
function shadeHex(hex, factor) {
  const c = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.floor(((c >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.floor(((c >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.floor((c & 0xff) * factor));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function syncWorldX() {
  // Mirror our 3D X position into state.playerWorldX so existing save/HUD logic is happy.
  if (!fpv.controls) return;
  const px = fpv.controls.object.position.x;
  const worldX = Math.max(60, Math.min(WORLD_WIDTH - 100, px / SCALE));
  state.playerWorldX = worldX;
}
