// The living orb. A glass sphere with drifting light inside; its colours, motion and
// edge follow the agent's phase and the live audio level. Pure canvas 2D, no deps.

const PALETTES = {
  // Apple system colours (dark variants) from the Cupertino Docs tokens.
  offline: ['#3d4a66', '#5e6b85', '#2f3a52', '#161b26'],
  idle: ['#0a84ff', '#5e5ce6', '#40c8e0', '#1c3d73'],
  listening: ['#0a84ff', '#40c8e0', '#63e6e2', '#5e5ce6'],
  hearing: ['#40c8e0', '#63e6e2', '#0a84ff', '#30d158'],
  thinking: ['#5e5ce6', '#bf5af2', '#0a84ff', '#7d7aff'],
  speaking: ['#bf5af2', '#ff375f', '#5e5ce6', '#0a84ff'],
  tool: ['#ff9f0a', '#ffd60a', '#ff375f', '#bf5af2'],
  confirm: ['#ffb340', '#ff9f0a', '#ff6961', '#ffd60a'],
  error: ['#ff453a', '#ff6961', '#ff375f', '#5e1a1a']
};

const SPEED = { offline: 0.15, idle: 0.35, listening: 0.5, hearing: 0.8, thinking: 1.6, speaking: 0.9, tool: 1.3, confirm: 0.7, error: 0.4 };

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a + (b - a) * t;
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export class Orb {
  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.compact = compact;
    this.phase = 'idle';
    this.level = 0;
    this.shown = 0;
    this.t = Math.random() * 100;
    this.colors = PALETTES.idle.map(hex);
    this.speed = SPEED.idle;
    this.running = false;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.frame = this.frame.bind(this);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  set(phase, level = this.level) {
    if (PALETTES[phase]) this.phase = phase;
    this.level = Math.max(0, Math.min(1, level || 0));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() { this.running = false; }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const target = PALETTES[this.phase].map(hex);
    const k = 1 - Math.pow(0.02, dt);
    this.colors = this.colors.map((c, i) => c.map((v, j) => lerp(v, target[i][j], k)));
    this.speed = lerp(this.speed, SPEED[this.phase], k);
    this.shown = lerp(this.shown, this.level, this.level > this.shown ? 1 - Math.pow(0.0005, dt) : 1 - Math.pow(0.08, dt));
    this.t += dt * this.speed;
    this.draw();
    requestAnimationFrame(this.frame);
  }

  blobPath(cx, cy, r, amp, seed) {
    const { ctx } = this;
    const N = 72;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const n = Math.sin(a * 3 + this.t * 1.3 + seed) * 0.5 + Math.sin(a * 5 - this.t * 1.7 + seed * 2) * 0.3 + Math.sin(a * 2 + this.t * 0.7 - seed) * 0.2;
      const rr = r * (1 + amp * n);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  draw() {
    const { ctx, w, h, colors, t } = this;
    const lv = this.shown;
    const cx = w / 2, cy = h / 2;
    const half = Math.min(w, h) / 2;
    const base = Math.min(w, h) * (this.compact ? 0.42 : 0.27);
    const r = base * (1 + lv * (this.compact ? 0.12 : 0.14) + Math.sin(t * 1.4) * 0.012);
    ctx.clearRect(0, 0, w, h);

    // Halo
    if (!this.compact) {
      const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, Math.min(half, r * (2.1 + lv * 0.6)));
      halo.addColorStop(0, rgba(colors[0], 0.32 + lv * 0.25));
      halo.addColorStop(0.45, rgba(colors[1], 0.1 + lv * 0.1));
      halo.addColorStop(1, rgba(colors[1], 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, half, 0, Math.PI * 2);
      ctx.fill();

      // Sound rings
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.35 + i / 3) % 1;
        ctx.strokeStyle = rgba(colors[i % 2], (1 - p) * (0.08 + lv * 0.35));
        ctx.lineWidth = 1.2;
        this.blobPath(cx, cy, Math.min(half * 0.9, r * (1.08 + p * (0.45 + lv * 0.3))), 0.02 + lv * 0.03, i * 2.1);
        ctx.stroke();
      }
    }

    // Sphere body, clipped to a softly wobbling edge
    ctx.save();
    this.blobPath(cx, cy, r, 0.012 + lv * 0.035, 0);
    ctx.clip();
    const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.05);
    body.addColorStop(0, rgba(colors[3], 1));
    body.addColorStop(1, rgba(colors[3].map((v) => v * 0.35), 1));
    ctx.fillStyle = body;
    ctx.fillRect(cx - r * 1.3, cy - r * 1.3, r * 2.6, r * 2.6);

    // Drifting inner lights
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const a = t * (0.6 + i * 0.23) + i * 1.7;
      const d = r * (0.35 + 0.18 * Math.sin(t * 0.9 + i));
      const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a * 1.2) * d;
      const br = r * (0.75 + 0.2 * Math.sin(t + i * 2) + lv * 0.35);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, rgba(colors[i], 0.75));
      g.addColorStop(1, rgba(colors[i], 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r * 1.3, cy - r * 1.3, r * 2.6, r * 2.6);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Glass: specular highlight and rim
    const spec = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.5, 0, cx - r * 0.35, cy - r * 0.5, r * 0.8);
    spec.addColorStop(0, 'rgba(255,255,255,0.38)');
    spec.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(cx - r * 1.3, cy - r * 1.3, r * 2.6, r * 2.6);
    const shade = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.05);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - r * 1.3, cy - r * 1.3, r * 2.6, r * 2.6);
    ctx.restore();

    ctx.strokeStyle = `rgba(255,255,255,${0.14 + lv * 0.2})`;
    ctx.lineWidth = this.compact ? 0.8 : 1;
    this.blobPath(cx, cy, r, 0.012 + lv * 0.035, 0);
    ctx.stroke();
  }
}
