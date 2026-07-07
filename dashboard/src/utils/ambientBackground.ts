// Ambient canvas background effects for the app shell. Each runner owns a single canvas: it reads
// the current color/intensity through the getters on every frame (so palette/theme switches and
// the intensity slider apply live, no restart needed) and stops scheduling frames once
// `isCancelled()` returns true — the caller flips that in its cleanup instead of us tracking a
// requestAnimationFrame id to cancel.

export type BgPattern =
  | 'none'
  | 'dots'
  | 'synapse'
  | 'rain'
  | 'constellations'
  | 'perlin-flow'
  | 'petals'
  | 'sparkles'
  | 'embers';

export const BG_PATTERNS: BgPattern[] = [
  'none',
  'dots',
  'synapse',
  'rain',
  'constellations',
  'perlin-flow',
  'petals',
  'sparkles',
  'embers',
];

// Patterns that need a canvas + RAF loop. 'none' renders nothing; 'dots' is a static CSS tile.
export const CANVAS_PATTERNS = new Set<BgPattern>([
  'synapse',
  'rain',
  'constellations',
  'perlin-flow',
  'petals',
  'sparkles',
  'embers',
]);

export interface EffectHandle {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  getColor: () => string;
  getIntensity: () => number; // 0..1, only rain uses this beyond the CSS-level opacity fade
  isCancelled: () => boolean;
}

export type EffectRunner = (handle: EffectHandle) => void;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = String(hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 37, g: 211, b: 102 };
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

const runSynapse: EffectRunner = ({ canvas, ctx, getColor, isCancelled }) => {
  const GRID = 24;
  const MAX_PULSES = 20;
  const SPEED_MIN = 2;
  const SPEED_MAX = 22;
  const TRAIL_LEN = 12;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let W = 0;
  let H = 0;
  let cols = 0;
  let rows = 0;
  const pulses: { x: number; y: number; dx: number; dy: number }[] = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / GRID);
    rows = Math.ceil(H / GRID);
  }
  resize();
  window.addEventListener('resize', resize);

  function spawnPulse() {
    const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
    if (Math.random() > 0.5) {
      const row = Math.floor(Math.random() * (rows + 1));
      pulses.push({ x: -TRAIL_LEN, y: row * GRID, dx: speed, dy: 0 });
    } else {
      const col = Math.floor(Math.random() * (cols + 1));
      pulses.push({ x: col * GRID, y: -TRAIL_LEN, dx: 0, dy: speed });
    }
  }

  function draw() {
    if (isCancelled()) {
      window.removeEventListener('resize', resize);
      return;
    }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();

    if (pulses.length < MAX_PULSES && Math.random() < 0.12) spawnPulse();

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.x += p.dx;
      p.y += p.dy;
      if (p.x > W + TRAIL_LEN || p.y > H + TRAIL_LEN) {
        pulses.splice(i, 1);
        continue;
      }

      const tx = p.x - (p.dx > 0 ? TRAIL_LEN : 0);
      const ty = p.y - (p.dy > 0 ? TRAIL_LEN : 0);
      const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, c);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      ctx.globalAlpha = 0.55;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  draw();
};

const runRain: EffectRunner = ({ canvas, ctx, getColor, getIntensity, isCancelled }) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const MAX_DROPS = 130;
  let W = 0;
  let H = 0;
  const drops: { x: number; y: number; len: number; speed: number; alpha: number }[] = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function spawn() {
    const len = 20 + Math.random() * 40;
    const speed = 4 + Math.random() * 8;
    drops.push({ x: Math.random() * W, y: -len, len, speed, alpha: 0.32 + Math.random() * 0.28 });
  }

  function draw() {
    if (isCancelled()) {
      window.removeEventListener('resize', resize);
      return;
    }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();
    const inten = getIntensity();
    const speedMult = 0.35 + inten * 0.65;

    if (drops.length < MAX_DROPS * inten && Math.random() < 0.6 * inten) spawn();

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.y += d.speed * speedMult;
      if (d.y > H + d.len) {
        drops.splice(i, 1);
        continue;
      }
      const grad = ctx.createLinearGradient(d.x, d.y - d.len, d.x, d.y);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, c);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = d.alpha;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - d.len);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  draw();
};

const runConstellations: EffectRunner = ({ canvas, ctx, getColor, isCancelled }) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const STAR_COUNT = 50;
  const CONNECT_DIST = 120;
  let W = 0;
  let H = 0;
  let stars: { x: number; y: number; vx: number; vy: number; r: number; phase: number }[] = [];

  function initStars() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        r: 0.8 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initStars();
  }
  resize();
  window.addEventListener('resize', resize);

  let t = 0;
  function draw() {
    if (isCancelled()) {
      window.removeEventListener('resize', resize);
      return;
    }
    requestAnimationFrame(draw);
    t += 0.01;
    ctx.clearRect(0, 0, W, H);
    const c = getColor();

    for (const s of stars) {
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < 0) s.x = W;
      if (s.x > W) s.x = 0;
      if (s.y < 0) s.y = H;
      if (s.y > H) s.y = 0;
    }

    ctx.strokeStyle = c;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const dx = stars[i].x - stars[j].x;
        const dy = stars[i].y - stars[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECT_DIST) {
          ctx.globalAlpha = (1 - dist / CONNECT_DIST) * 0.15;
          ctx.beginPath();
          ctx.moveTo(stars[i].x, stars[i].y);
          ctx.lineTo(stars[j].x, stars[j].y);
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = c;
    for (const s of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + s.phase);
      ctx.globalAlpha = 0.15 + twinkle * 0.25;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  draw();
};

function noise2d(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = noise2d(ix, iy);
  const b = noise2d(ix + 1, iy);
  const cc = noise2d(ix, iy + 1);
  const d = noise2d(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy;
}

const runPerlinFlow: EffectRunner = ({ canvas, ctx, getColor, isCancelled }) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  let t = 0;
  const particles: { x: number; y: number; life: number }[] = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (particles.length === 0) {
      for (let i = 0; i < 200; i++) particles.push({ x: Math.random() * W, y: Math.random() * H, life: Math.random() });
    }
  }
  resize();
  window.addEventListener('resize', resize);

  function getBg(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--bg-light').trim() || '#0f172a';
  }

  let cachedBg = '';
  let fadeStyle = '';
  function getFade(): string {
    const bg = getBg();
    if (bg !== cachedBg) {
      cachedBg = bg;
      const { r, g, b } = hexToRgb(bg);
      fadeStyle = `rgba(${r},${g},${b},0.05)`;
    }
    return fadeStyle;
  }

  function draw() {
    if (isCancelled()) {
      window.removeEventListener('resize', resize);
      return;
    }
    requestAnimationFrame(draw);
    ctx.fillStyle = getFade();
    ctx.fillRect(0, 0, W, H);
    const c = getColor();
    for (const p of particles) {
      const n = smoothNoise(p.x * 0.004 + t * 0.0008, p.y * 0.004 + 100);
      const angle = n * Math.PI * 6;
      const speed = 1 + smoothNoise(p.x * 0.003, p.y * 0.003 + 50) * 1.5;
      p.x += Math.cos(angle) * speed;
      p.y += Math.sin(angle) * speed;
      p.life -= 0.001;
      if (p.life <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
        p.x = Math.random() * W;
        p.y = Math.random() * H;
        p.life = 1;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.globalAlpha = p.life * 0.15;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    t++;
  }
  draw();
};

interface Petal {
  x: number;
  y: number;
  size: number;
  rot: number;
  vr: number;
  vy: number;
  drift: number;
  driftSpeed: number;
  wobble: number;
}

function makePetal(W: number): Petal {
  return {
    x: Math.random() * W,
    y: -10 - Math.random() * 40,
    size: 3 + Math.random() * 5,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.03,
    vy: 0.3 + Math.random() * 0.6,
    drift: Math.random() * Math.PI * 2,
    driftSpeed: 0.008 + Math.random() * 0.012,
    wobble: 0.3 + Math.random() * 0.8,
  };
}

const runPetals: EffectRunner = ({ canvas, ctx, getColor, isCancelled }) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  const petals: Petal[] = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (petals.length === 0) {
      for (let i = 0; i < 30; i++) {
        const p = makePetal(W);
        p.y = Math.random() * H;
        petals.push(p);
      }
    }
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    if (isCancelled()) {
      window.removeEventListener('resize', resize);
      return;
    }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();
    for (const p of petals) {
      p.y += p.vy;
      p.rot += p.vr;
      p.drift += p.driftSpeed;
      p.x += Math.sin(p.drift) * p.wobble;
      if (p.y > H + 15) Object.assign(p, makePetal(W));

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.ellipse(-p.size * 0.2, 0, p.size * 0.6, p.size * 0.3, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.ellipse(p.size * 0.2, 0, p.size * 0.6, p.size * 0.3, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  draw();
};

interface Spark {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  life: number;
}

function makeSpark(W: number, H: number): Spark {
  return {
    x: Math.random() * W,
    y: Math.random() * H,
    size: 2 + Math.random() * 5,
    phase: Math.random() * Math.PI * 2,
    speed: 0.015 + Math.random() * 0.03,
    life: 0.5 + Math.random() * 0.5,
  };
}

const runSparkles: EffectRunner = ({ canvas, ctx, getColor, isCancelled }) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  const sparkles: Spark[] = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sparkles.length === 0) {
      for (let i = 0; i < 35; i++) sparkles.push(makeSpark(W, H));
    }
  }
  resize();
  window.addEventListener('resize', resize);

  function drawStar(x: number, y: number, r: number, c: string, alpha: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = c;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.15, -r * 0.15, r, 0);
    ctx.quadraticCurveTo(r * 0.15, r * 0.15, 0, r);
    ctx.quadraticCurveTo(-r * 0.15, r * 0.15, -r, 0);
    ctx.quadraticCurveTo(-r * 0.15, -r * 0.15, 0, -r);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (isCancelled()) {
      window.removeEventListener('resize', resize);
      return;
    }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();
    for (const s of sparkles) {
      s.phase += s.speed;
      const twinkle = Math.sin(s.phase);
      const alpha = Math.max(0, twinkle) * 0.25 * s.life;
      const scale = 0.5 + Math.max(0, twinkle) * 0.5;
      if (alpha > 0.01) drawStar(s.x, s.y, s.size * scale, c, alpha);
      if (s.phase > Math.PI * 6) Object.assign(s, makeSpark(W, H));
    }
    ctx.globalAlpha = 1;
  }
  draw();
};

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  maxLife: number;
  wobble: number;
  spark: boolean;
}

function makeEmber(W: number, H: number): Ember {
  return {
    x: Math.random() * W,
    y: H + Math.random() * 40,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.3 - Math.random() * 0.8,
    r: 0.3 + Math.random() * 0.6,
    life: 0,
    maxLife: 220 + Math.random() * 220,
    wobble: Math.random() * Math.PI * 2,
    spark: false,
  };
}

const runEmbers: EffectRunner = ({ canvas, ctx, getColor, isCancelled }) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  const embers: Ember[] = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (embers.length === 0) {
      for (let i = 0; i < 60; i++) {
        const e = makeEmber(W, H);
        e.y = Math.random() * H;
        e.life = Math.random() * e.maxLife;
        embers.push(e);
      }
    }
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    if (isCancelled()) {
      window.removeEventListener('resize', resize);
      return;
    }
    requestAnimationFrame(draw);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    const color = getColor();
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.wobble += 0.03;
      e.x += e.vx + Math.sin(e.wobble) * 0.5;
      e.y += e.vy;
      e.life++;
      if (e.life > e.maxLife || e.y < -20) {
        embers.splice(i, 1);
        if (embers.length < 70) embers.push(makeEmber(W, H));
        continue;
      }
      if (!e.spark && Math.random() < 0.003) e.spark = true;
      const lifeRatio = e.life / e.maxLife;
      const fade = Math.min(1, Math.min(lifeRatio * 4, (1 - lifeRatio) * 3));
      const r = e.r * (e.spark ? 2.4 : 1);
      const a = (e.spark ? 0.9 : 0.55) * fade;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 4);
      g.addColorStop(0, rgba(color, a));
      g.addColorStop(0.4, rgba(color, a * 0.3));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(e.x - r * 4, e.y - r * 4, r * 8, r * 8);
      ctx.fillStyle = rgba('#ffffff', a * 0.6);
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      e.spark = false;
    }

    if (Math.random() < 0.015) {
      const bx = Math.random() * W;
      for (let i = 0; i < 5; i++) {
        const e = makeEmber(W, H);
        e.x = bx + (Math.random() - 0.5) * 40;
        e.y = H - 10;
        e.vy *= 1.5;
        embers.push(e);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  draw();
};

export const EFFECT_RUNNERS: Partial<Record<BgPattern, EffectRunner>> = {
  synapse: runSynapse,
  rain: runRain,
  constellations: runConstellations,
  'perlin-flow': runPerlinFlow,
  petals: runPetals,
  sparkles: runSparkles,
  embers: runEmbers,
};
