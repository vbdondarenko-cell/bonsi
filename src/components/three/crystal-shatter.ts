/**
 * «Схлопування сайту в кристал», реалістична версія.
 *
 * У момент кліку видима частина сайту знімається в картинку (html-to-image) і розрізається на 320 трикутних
 * плиток: разом вони виглядають як звичайна сторінка. Далі плитки злітаються, перевертаються й складаються
 * в обертову кулю з гранями кристала (на кожній грані шматок сайту), куля зжимається в крапку, спалахує
 * і вибухає: плитки розлітаються хвилею й повертаються на місце, знову збираючись у сайт.
 *
 * Усе вантажиться лише при першому кліку/наведенні: three.js уже є в чанку фону, html-to-image окремо.
 */
import type { BufferAttribute, Material, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import type { BlastOptions } from "./crystal-blast";

type Vec3 = [number, number, number];
type Tri = [Vec3, Vec3, Vec3];

const COLS = 16;
const ROWS = 10;
const LEVELS = 2; // 20 · 4² = 320 граней = 16 · 10 · 2 плиток

// Тривалість фаз, секунди.
const T_FOLD = 1.5;
const T_HOLD = 0.6;
const T_COMPRESS = 0.85;
const T_POINT = 0.12;
const T_EXPLODE = 1.5;
const FOLD_STAGGER = 0.5;
const EXPLODE_STAGGER = 0.6;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Ікосфера: грані проти годинникової стрілки, дивлячись ззовні. */
function buildIco(levels: number): Tri[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = (
    [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] as Vec3[]
  ).map(norm);
  const idx: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  let faces: Tri[] = idx.map(([a, b, c]) => [verts[a], verts[b], verts[c]]);
  const mid = (a: Vec3, b: Vec3) => norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  for (let l = 0; l < levels; l += 1) {
    const next: Tri[] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return faces;
}

let fontCss: Promise<string | undefined> | undefined;

function loadFontCss(root: HTMLElement) {
  fontCss ??= import("html-to-image").then((m) => m.getFontEmbedCSS(root)).catch(() => undefined);
  return fontCss;
}

/** Підігріває чанки й CSS шрифтів, щоб клік стартував без затримки. */
export function prepareShatter(root: HTMLElement) {
  void import("three");
  void loadFontCss(root);
}

/** Повертає функцію скасування; кидає помилку, якщо знімок чи WebGL недоступні (тоді працює запасний варіант). */
export async function runShatter({ root, core, onDone }: BlastOptions, cancelled: () => boolean): Promise<() => void> {
  const THREE = await import("three");
  const { toCanvas } = await import("html-to-image");

  const W = document.documentElement.clientWidth;
  const H = window.innerHeight;
  const cx = core.x;
  const cy = core.y;
  const ballC = new THREE.Vector3(cx - W / 2, H / 2 - cy, 0);
  const radius = Math.min(Math.max(core.r * 1.15, 120), Math.min(W, H) * 0.3);
  const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 60;

  // Прокрутка заблокована від кліку до кінця: кристал їде за скролом, а плитки мають збиратися в одну точку.
  const stop = (event: Event) => event.preventDefault();
  const stopKeys = (event: KeyboardEvent) => {
    if ([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.preventDefault();
  };
  window.addEventListener("wheel", stop, { passive: false });
  window.addEventListener("touchmove", stop, { passive: false });
  window.addEventListener("keydown", stopKeys);
  const release = () => {
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchmove", stop);
    window.removeEventListener("keydown", stopKeys);
  };

  let snapshot: HTMLCanvasElement;
  try {
    core.spin = 6; // кристал «заряджається», поки знімається сторінка
    const css = await loadFontCss(root);
    const box = root.getBoundingClientRect();
    snapshot = await toCanvas(root, {
      width: W,
      height: H,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      fontEmbedCSS: css,
      style: { transform: `translate(${box.left}px, ${box.top}px)`, transformOrigin: "top left" },
    });
  } catch (error) {
    release();
    core.spin = 0;
    throw error;
  }
  if (cancelled()) {
    release();
    core.spin = 0;
    return () => {};
  }

  // ───────── Сцена ─────────
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  const dom = renderer.domElement;
  dom.setAttribute("aria-hidden", "true");
  Object.assign(dom.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "90", pointerEvents: "none" });
  document.body.appendChild(dom);

  const fov = 40;
  const camera = new THREE.PerspectiveCamera(fov, W / H, 10, 9000);
  camera.position.set(0, 0, H / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  const scene = new THREE.Scene();

  const texture = new THREE.CanvasTexture(snapshot);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const faces = buildIco(LEVELS);
  const N = COLS * ROWS * 2;
  const rand = mulberry32(7);

  // Плитки площини: центр, зсуви вершин, UV.
  const planeCenter: Vector3[] = [];
  const planeOff: Vec3[][] = [];
  const uvs = new Float32Array(N * 3 * 2);
  const cw = W / COLS;
  const ch = H / ROWS;
  const world = (x: number, y: number): Vec3 => [x - W / 2, H / 2 - y, 0];
  let n = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const x0 = c * cw;
      const x1 = x0 + cw;
      const y0 = r * ch;
      const y1 = y0 + ch;
      const tl: [number, number] = [x0, y0];
      const tr: [number, number] = [x1, y0];
      const bl: [number, number] = [x0, y1];
      const br: [number, number] = [x1, y1];
      for (const tri of [[tl, bl, tr], [tr, bl, br]]) {
        const pts = tri.map(([x, y]) => world(x, y));
        const cen = new THREE.Vector3(
          (pts[0][0] + pts[1][0] + pts[2][0]) / 3,
          (pts[0][1] + pts[1][1] + pts[2][1]) / 3,
          0,
        );
        planeCenter.push(cen);
        planeOff.push(pts.map((p) => [p[0] - cen.x, p[1] - cen.y, 0] as Vec3));
        tri.forEach(([x, y], k) => {
          uvs[(n * 3 + k) * 2] = x / W;
          uvs[(n * 3 + k) * 2 + 1] = 1 - y / H;
        });
        n += 1;
      }
    }
  }

  // Грані кулі: центр, зсуви вершин у локальній системі грані, орієнтація.
  const faceCenter: Vector3[] = [];
  const faceOff: Vec3[][] = [];
  const faceQuat: Quaternion[] = [];
  for (const [a, b, c] of faces) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const vc = new THREE.Vector3(...c);
    const cen = new THREE.Vector3().add(va).add(vb).add(vc).divideScalar(3);
    const nrm = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
    if (nrm.dot(cen) < 0) nrm.negate();
    const ax = new THREE.Vector3().subVectors(va, cen).normalize();
    const ay = new THREE.Vector3().crossVectors(nrm, ax);
    faceCenter.push(cen);
    faceOff.push(
      [va, vb, vc].map((v) => {
        const d = new THREE.Vector3().subVectors(v, cen);
        return [d.dot(ax), d.dot(ay), d.dot(nrm)] as Vec3;
      }),
    );
    faceQuat.push(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, nrm)));
  }

  // Плитка → грань: сусідні фрагменти сторінки лягають поруч на кулі (приблизна рівнопроміжна розгортка).
  const faceDirs = faceCenter.map((v) => v.clone().normalize());
  const used = new Array<boolean>(N).fill(false);
  const assign = new Array<number>(N).fill(0);
  const order = Array.from({ length: N }, (_, i) => i).sort(() => rand() - 0.5);
  for (const i of order) {
    const u = (planeCenter[i].x + W / 2) / W;
    const v = 1 - (planeCenter[i].y + H / 2) / H;
    const lon = (u - 0.5) * Math.PI * 2;
    const lat = (0.5 - v) * Math.PI * 0.85;
    const dir = new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
    let best = -1;
    let bestDot = -2;
    for (let j = 0; j < N; j += 1) {
      if (used[j]) continue;
      const dot = dir.dot(faceDirs[j]);
      if (dot > bestDot) {
        bestDot = dot;
        best = j;
      }
    }
    used[best] = true;
    assign[i] = best;
  }

  // Індивідуальний «характер» плитки.
  const maxDist = Math.max(...planeCenter.map((c) => Math.hypot(c.x - ballC.x, c.y - ballC.y)), 1);
  const dist = planeCenter.map((c) => Math.hypot(c.x - ballC.x, c.y - ballC.y) / maxDist);
  const wobbleAxis = Array.from({ length: N }, () => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize());
  const wobbleAmp = Array.from({ length: N }, () => (rand() - 0.5) * 2 * Math.PI * 1.3);
  const arc = Array.from({ length: N }, () => 80 + rand() * 360);
  const swirl = Array.from({ length: N }, () => (rand() - 0.5) * 0.5);

  // Геометрія плиток.
  const positions = new Float32Array(N * 3 * 3);
  const colors = new Float32Array(N * 3 * 3);
  const lineColors = new Float32Array(N * 3 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    vertexColors: true,
    transparent: true,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Світні ребра граней проявляються разом із кулею.
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", geometry.getAttribute("position"));
  lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));
  const lineIndex: number[] = [];
  for (let i = 0; i < N; i += 1) lineIndex.push(i * 3, i * 3 + 1, i * 3 + 1, i * 3 + 2, i * 3 + 2, i * 3);
  lineGeometry.setIndex(lineIndex);
  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  scene.add(lines);

  // Тіло кулі: темно-фіолетове ядро, щоб прозорі місця плиток не показували порожнечу.
  const innerMaterial = new THREE.MeshBasicMaterial({ color: 0x150d38, toneMapped: false });
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), innerMaterial);
  inner.position.copy(ballC);
  inner.scale.setScalar(0.0001);
  scene.add(inner);

  // Свічення / спалах.
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 128;
  const gctx = glowCanvas.getContext("2d");
  if (gctx) {
    const g = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(190,170,255,0.55)");
    g.addColorStop(1, "rgba(123,92,255,0)");
    gctx.fillStyle = g;
    gctx.fillRect(0, 0, 128, 128);
  }
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.position.set(ballC.x, ballC.y, 60);
  scene.add(glow);

  // Ударні хвилі.
  const makeRing = () => {
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xcfc4ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.986, 1, 160), ringMaterial);
    ring.position.set(ballC.x, ballC.y, 40);
    ring.visible = false;
    scene.add(ring);
    return ring;
  };
  const ringA = makeRing();
  const ringB = makeRing();

  // Іскри.
  const SPARKS = 320;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkDir = Array.from({ length: SPARKS }, () => {
    const a = rand() * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a), z: (rand() - 0.5) * 0.6, speed: 0.2 + rand() * 0.95 };
  });
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  const sparkMaterial = new THREE.PointsMaterial({
    color: 0xd9d0ff,
    size: 3.2,
    sizeAttenuation: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  sparks.visible = false;
  scene.add(sparks);

  // ───────── Кадр ─────────
  const qBall = new THREE.Quaternion();
  const qTile = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const qWobble = new THREE.Quaternion();
  const qIdentity = new THREE.Quaternion();
  const axisBall = new THREE.Vector3(0.25, 1, 0.08).normalize();
  const tiltBall = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.45);
  const tmp = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const light = new THREE.Vector3(0.5, 0.75, 0.9).normalize();
  const positionAttr = geometry.getAttribute("position") as BufferAttribute;
  const colorAttr = geometry.getAttribute("color") as BufferAttribute;
  const lineColorAttr = lineGeometry.getAttribute("color") as BufferAttribute;
  const sparkAttr = sparkGeometry.getAttribute("position") as BufferAttribute;

  const tFoldEnd = T_FOLD;
  const tHoldEnd = tFoldEnd + T_HOLD;
  const tCompressEnd = tHoldEnd + T_COMPRESS;
  const tPointEnd = tCompressEnd + T_POINT;
  const tTotal = tPointEnd + T_EXPLODE;

  let angle = 0;

  /** Оновлює всі плитки для моменту t; b — частка «кулі» в плитці (0 = у сторінці, 1 = у кулі). */
  const frameAt = (t: number, dt: number) => {
    let R = radius;
    let speed = 0.4;
    let glowAlpha = 0;
    let glowSize = 0;
    let shake = 0;
    let phase: "fold" | "hold" | "compress" | "point" | "explode" = "fold";
    let p = 0;

    if (t < tFoldEnd) {
      phase = "fold";
      p = t / T_FOLD;
      speed = 0.4 + 1.6 * p;
      glowAlpha = 0.12 + 0.3 * p;
      glowSize = radius * (2.2 + 0.8 * p);
    } else if (t < tHoldEnd) {
      phase = "hold";
      p = (t - tFoldEnd) / T_HOLD;
      speed = 2 + 1.5 * p;
      R = radius * (1 + 0.035 * Math.sin(p * Math.PI * 6));
      glowAlpha = 0.45;
      glowSize = radius * 3;
    } else if (t < tCompressEnd) {
      phase = "compress";
      p = (t - tHoldEnd) / T_COMPRESS;
      const e = easeInCubic(p);
      speed = 3.5 + 11 * e;
      R = radius * (1 - 0.985 * e);
      glowAlpha = 0.5 + 0.5 * e;
      glowSize = radius * (3 - 1.6 * e);
      shake = 3 * e;
    } else if (t < tPointEnd) {
      phase = "point";
      p = (t - tCompressEnd) / T_POINT;
      speed = 14;
      R = radius * 0.015;
      glowAlpha = 1;
      glowSize = 150 + 120 * p;
      shake = 5;
    } else {
      phase = "explode";
      p = clamp01((t - tPointEnd) / T_EXPLODE);
      speed = 8 * (1 - p);
      R = radius * 0.015;
      glowAlpha = Math.pow(1 - p, 1.6);
      glowSize = 260 + easeOutCubic(p) * far * 1.1;
      shake = 14 * Math.pow(1 - p, 2);
    }

    angle += speed * dt;
    qBall.setFromAxisAngle(axisBall, angle).premultiply(tiltBall);

    let sumB = 0;
    for (let i = 0; i < N; i += 1) {
      let b: number;
      let push = 0;
      if (phase === "fold") {
        b = easeInOutCubic(clamp01((t - dist[i] * FOLD_STAGGER) / (T_FOLD - FOLD_STAGGER)));
      } else if (phase === "explode") {
        const te = t - tPointEnd;
        b = 1 - easeOutCubic(clamp01((te - dist[i] * EXPLODE_STAGGER) / (T_EXPLODE - EXPLODE_STAGGER)));
        push = 0.2;
      } else {
        b = 1;
      }
      sumB += b;
      const j = assign[i];

      // Орієнтація: від площини до грані кулі (з обертом кулі), плюс «перевертання» в польоті.
      qTmp.copy(qBall).multiply(faceQuat[j]);
      qTile.copy(qIdentity).slerp(qTmp, b);
      const fly = Math.sin(Math.PI * b);
      qWobble.setFromAxisAngle(wobbleAxis[i], wobbleAmp[i] * fly);
      qTile.multiply(qWobble);

      // Положення: від місця у сторінці до місця на кулі, з дугою до камери й закрученням.
      centre.copy(faceCenter[j]).multiplyScalar(R).applyQuaternion(qBall).add(ballC);
      const pc = planeCenter[i];
      centre.set(pc.x + (centre.x - pc.x) * b, pc.y + (centre.y - pc.y) * b, centre.z * b);
      const dx = pc.x - ballC.x;
      const dy = pc.y - ballC.y;
      const len = Math.hypot(dx, dy) || 1;
      centre.x += (-dy / len) * fly * swirl[i] * len * 0.6 + (dx / len) * fly * push * len;
      centre.y += (dx / len) * fly * swirl[i] * len * 0.6 + (dy / len) * fly * push * len;
      centre.z += fly * arc[i];

      for (let k = 0; k < 3; k += 1) {
        const po = planeOff[i][k];
        const fo = faceOff[j][k];
        tmp.set(po[0] + (fo[0] * R - po[0]) * b, po[1] + (fo[1] * R - po[1]) * b, po[2] + (fo[2] * R - po[2]) * b);
        tmp.applyQuaternion(qTile).add(centre);
        positionAttr.setXYZ(i * 3 + k, tmp.x, tmp.y, tmp.z);
      }

      // Освітлення граней: у площині плитка світла як є, у кулі — об'ємно й з фіолетовим відблиском.
      normal.set(0, 0, 1).applyQuaternion(qTile);
      const shade = 0.32 + 0.85 * Math.max(0, normal.dot(light));
      const cr = 1 + (shade * 0.92 - 1) * b;
      const cg = 1 + (shade * 0.82 - 1) * b;
      const cb = 1 + (shade * 1.12 - 1) * b;
      const lineK = b * (0.35 + 0.5 * shade);
      for (let k = 0; k < 3; k += 1) {
        colorAttr.setXYZ(i * 3 + k, cr, cg, cb);
        lineColorAttr.setXYZ(i * 3 + k, 0.72 * lineK, 0.64 * lineK, 1 * lineK);
      }
    }
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    lineColorAttr.needsUpdate = true;

    const avgB = sumB / N;
    inner.scale.setScalar(Math.max(0.0001, R * 0.9 * avgB * avgB * avgB));
    inner.visible = avgB > 0.02;

    glow.scale.set(glowSize, glowSize, 1);
    glowMaterial.opacity = clamp01(glowAlpha);

    if (phase === "explode") {
      ringA.visible = ringB.visible = sparks.visible = true;
      ringA.scale.setScalar(Math.max(1, far * easeOutCubic(p) * 1.05));
      (ringA.material as MeshBasicMaterial).opacity = (1 - p) * 0.9;
      const pB = clamp01((p - 0.1) / 0.9);
      ringB.scale.setScalar(Math.max(1, far * easeOutCubic(pB) * 0.7));
      (ringB.material as MeshBasicMaterial).opacity = (1 - pB) * 0.5;
      const spread = easeOutCubic(p) * far * 1.1;
      for (let s = 0; s < SPARKS; s += 1) {
        const d = sparkDir[s];
        sparkAttr.setXYZ(s, ballC.x + d.x * d.speed * spread, ballC.y + d.y * d.speed * spread, 30 + d.z * spread * 0.6);
      }
      sparkAttr.needsUpdate = true;
      sparkMaterial.opacity = Math.max(0, 1 - p * 1.1);
    } else {
      ringA.visible = ringB.visible = sparks.visible = false;
    }

    camera.position.x = shake ? (Math.random() - 0.5) * shake : 0;
    camera.position.y = shake ? (Math.random() - 0.5) * shake : 0;

    // Справжній 3D-кристал зникає в кулі й народжується заново після вибуху.
    core.scale = phase === "explode" && p > 0.55 ? 1 : 0.001;
    core.spin = 0;
  };

  // Підміна без стрибка: перший кадр = точна копія сторінки, тоді справжній вміст ховається.
  frameAt(0, 0);
  renderer.render(scene, camera);
  root.style.visibility = "hidden";

  let frame = 0;
  let finished = false;
  let last = performance.now();
  const startedAt = last;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    release();
    root.style.visibility = "";
    dom.remove();
    geometry.dispose();
    lineGeometry.dispose();
    sparkGeometry.dispose();
    material.dispose();
    lineMaterial.dispose();
    innerMaterial.dispose();
    inner.geometry.dispose();
    glowMaterial.dispose();
    glowTexture.dispose();
    sparkMaterial.dispose();
    for (const ring of [ringA, ringB]) {
      ring.geometry.dispose();
      (ring.material as Material).dispose();
    }
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    core.scale = 1;
    core.spin = 0;
  };

  const tick = (now: number) => {
    try {
      const t = (now - startedAt) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (t >= tTotal) {
        frameAt(tTotal - 0.0001, 0);
        renderer.render(scene, camera);
        cleanup();
        onDone();
        return;
      }
      frameAt(t, dt);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    } catch {
      // Будь-яка помилка рендера не повинна лишити сайт прихованим.
      cleanup();
      onDone();
    }
  };
  frame = requestAnimationFrame(tick);
  return cleanup;
}
