/**
 * Анімація «схлопування сайту в кристал»: за кліком по кристалу весь вміст сторінки стискається
 * в кулю з гранями кристала, зжимається в крапку й вибухає назад у сайт.
 *
 * Вміст ховається через clip-path на обгортці (він не створює containing block для fixed-елементів,
 * тому шапка не «стрибає»), а грані, спалах, ударна хвиля й уламки малюються на тимчасовому canvas поверх.
 */

/** Екранний стан кристала: Core пише позицію, анімація керує масштабом і обертанням. */
export type CoreState = {
  /** Центр кристала, CSS-пікселі вікна. */
  x: number;
  y: number;
  /** Радіус каркаса в пікселях. */
  r: number;
  /** Множник масштабу кристала в 3D (1 = звичайний). */
  scale: number;
  /** Додаткове прискорення обертання (0 = звичайне). */
  spin: number;
};

export function createCoreState(): CoreState {
  return { x: -9999, y: -9999, r: 0, scale: 1, spin: 0 };
}

const T_GATHER = 1100;
const T_COMPRESS = 650;
const T_HOLD = 140;
const T_EXPLODE = 1050;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

type Vec3 = [number, number, number];
type Shell = { verts: Vec3[]; edges: [number, number][] };

/** Ікосфера (ікосаедр з одним поділом): ті самі грані, що й у кристала, але вже майже куля. */
function buildShell(): Shell {
  const t = (1 + Math.sqrt(5)) / 2;
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const verts: Vec3[] = (
    [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] as Vec3[]
  ).map(norm);
  const faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const cache = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    verts.push(
      norm([
        (verts[a][0] + verts[b][0]) / 2,
        (verts[a][1] + verts[b][1]) / 2,
        (verts[a][2] + verts[b][2]) / 2,
      ]),
    );
    cache.set(key, verts.length - 1);
    return verts.length - 1;
  };
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push([a, b]);
  };
  for (const [a, b, c] of faces) {
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    for (const tri of [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]) {
      addEdge(tri[0], tri[1]);
      addEdge(tri[1], tri[2]);
      addEdge(tri[2], tri[0]);
    }
  }
  return { verts, edges };
}

type Particle = { angle: number; speed: number; size: number; hue: number };

function buildParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    speed: 0.25 + Math.random() * 0.85,
    size: 1 + Math.random() * 2.6,
    hue: Math.random(),
  }));
}

export type BlastOptions = {
  /** Обгортка всього вмісту сайту, яку «складаємо». */
  root: HTMLElement;
  core: CoreState;
  onDone: () => void;
};

/**
 * Запускає анімацію: реалістична версія (знімок сайту → плитки → куля → вибух), а якщо знімок чи WebGL
 * недоступні, то запасна. Повертає функцію скасування (повністю прибирає всі сліди).
 */
export function runCrystalBlast(options: BlastOptions): () => void {
  let cancelled = false;
  let inner: (() => void) | undefined;
  import("./crystal-shatter")
    .then(({ runShatter }) => runShatter(options, () => cancelled))
    .then((cancel) => {
      inner = cancel;
      if (cancelled) cancel();
    })
    .catch(() => {
      if (!cancelled) inner = runLegacyBlast(options);
    });
  return () => {
    cancelled = true;
    inner?.();
  };
}

/** Підігріває все потрібне для анімації (чанки, шрифти), щоб клік стартував без затримки. */
export function prepareCrystalBlast(root: HTMLElement) {
  void import("./crystal-shatter").then((module) => module.prepareShatter(root));
}

/** Запасний варіант (без знімка сторінки): коло-маска + грані на 2D canvas. Повертає функцію скасування. */
function runLegacyBlast({ root, core, onDone }: BlastOptions): () => void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const cx = core.x;
  const cy = core.y;
  const sphere = Math.max(core.r, 100);
  const far = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) + 60;

  // Центр кола в координатах обгортки (вона вища за вікно й може бути прокручена).
  const box = root.getBoundingClientRect();
  const localX = cx - box.left;
  const localY = cy - box.top;
  const setClip = (radius: number) => {
    root.style.clipPath = `circle(${Math.max(0, radius).toFixed(1)}px at ${localX.toFixed(1)}px ${localY.toFixed(1)}px)`;
  };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "90",
    pointerEvents: "none",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const shell = buildShell();
  const particles = buildParticles(150);

  // Під час анімації сторінка не прокручується: кристал їде за скролом, а збір іде в зафіксовану точку.
  const stop = (event: Event) => event.preventDefault();
  const stopKeys = (event: KeyboardEvent) => {
    if ([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) event.preventDefault();
  };
  window.addEventListener("wheel", stop, { passive: false });
  window.addEventListener("touchmove", stop, { passive: false });
  window.addEventListener("keydown", stopKeys);

  const drawShell = (radius: number, yaw: number, pitch: number, alpha: number) => {
    if (!ctx || radius < 1 || alpha <= 0.01) return;
    const cyaw = Math.cos(yaw);
    const syaw = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const pts = shell.verts.map(([x, y, z]) => {
      const x1 = x * cyaw + z * syaw;
      const z1 = -x * syaw + z * cyaw;
      return [cx + x1 * radius, cy + (y * cp - z1 * sp) * radius, y * sp + z1 * cp] as const;
    });
    ctx.lineWidth = 1.2;
    for (const [a, b] of shell.edges) {
      const depth = (pts[a][2] + pts[b][2]) / 2;
      ctx.strokeStyle = `rgba(196,181,255,${(alpha * (0.15 + 0.6 * ((depth + 1) / 2))).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
      ctx.stroke();
    }
  };

  const drawGlow = (radius: number, alpha: number) => {
    if (!ctx || radius < 1 || alpha <= 0.01) return;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    gradient.addColorStop(0.35, `rgba(165,145,255,${(alpha * 0.55).toFixed(3)})`);
    gradient.addColorStop(1, "rgba(165,145,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawRing = (radius: number, alpha: number, lineWidth: number) => {
    if (!ctx || radius < 1 || alpha <= 0.01) return;
    ctx.save();
    ctx.strokeStyle = `rgba(185,168,255,${alpha.toFixed(3)})`;
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = "rgba(123,92,255,0.9)";
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  const start = performance.now();
  const total = T_GATHER + T_COMPRESS + T_HOLD + T_EXPLODE;
  let frame = 0;
  let finished = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchmove", stop);
    window.removeEventListener("keydown", stopKeys);
    root.style.clipPath = "";
    canvas.remove();
    core.scale = 1;
    core.spin = 0;
  };

  const tick = (now: number) => {
    const elapsed = now - start;
    if (elapsed >= total) {
      cleanup();
      onDone();
      return;
    }
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
    }
    const spinAngle = elapsed / 1000;

    if (elapsed < T_GATHER) {
      // 1. Сайт стискається до кулі розміром із кристал; навколо проявляються грані.
      const p = clamp01(elapsed / T_GATHER);
      const radius = far + (sphere - far) * easeInOutCubic(p);
      setClip(radius);
      core.scale = 1;
      core.spin = p * 12;
      drawShell(sphere, spinAngle * (1 + p * 5), 0.5 + p * 0.4, 0.25 + p * 0.75);
      drawRing(radius, 0.15 + p * 0.75, 1.5 + p * 1.5);
    } else if (elapsed < T_GATHER + T_COMPRESS) {
      // 2. Куля зжимається в крапку.
      const p = clamp01((elapsed - T_GATHER) / T_COMPRESS);
      const e = easeInCubic(p);
      const radius = sphere * (1 - e);
      setClip(radius);
      core.scale = 0.001;
      core.spin = 12;
      drawShell(radius, spinAngle * 6, 0.9 + p * 1.2, 1);
      drawRing(radius, 0.9, 3);
      drawGlow(18 + e * 70, 0.25 + e * 0.75);
    } else if (elapsed < T_GATHER + T_COMPRESS + T_HOLD) {
      // 3. Крапка: мить напруження перед вибухом.
      const p = clamp01((elapsed - T_GATHER - T_COMPRESS) / T_HOLD);
      setClip(0);
      core.scale = 0.001;
      drawGlow(60 + p * 40, 1);
    } else {
      // 4. Вибух: сайт розлітається з крапки назад на весь екран, летять уламки та ударна хвиля.
      const p = clamp01((elapsed - T_GATHER - T_COMPRESS - T_HOLD) / T_EXPLODE);
      const spread = easeOutCubic(p);
      setClip(far * easeOutQuart(p));
      core.scale = p > 0.3 ? 1 : 0.001;
      core.spin = Math.max(0, 8 * (1 - p));
      drawGlow(120 + spread * far * 0.35, Math.max(0, 1 - p * 2.6));
      drawRing(far * spread * 1.05, (1 - p) * 0.9, 4 * (1 - p) + 0.5);
      drawRing(far * easeOutCubic(clamp01(p * 1.25)) * 0.7, (1 - p) * 0.5, 2);
      drawShell(far * spread * 0.85 + 4, spinAngle * 3, 1.4, Math.max(0, 1 - p * 1.4));
      if (ctx) {
        const alpha = Math.max(0, 1 - p * 1.15).toFixed(3);
        for (const particle of particles) {
          const distance = far * particle.speed * spread;
          ctx.fillStyle = particle.hue > 0.7 ? `rgba(255,255,255,${alpha})` : `rgba(165,145,255,${alpha})`;
          ctx.beginPath();
          ctx.arc(
            cx + Math.cos(particle.angle) * distance,
            cy + Math.sin(particle.angle) * distance,
            particle.size * (1 - p * 0.6),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }
    frame = requestAnimationFrame(tick);
  };

  setClip(far);
  frame = requestAnimationFrame(tick);
  return cleanup;
}
