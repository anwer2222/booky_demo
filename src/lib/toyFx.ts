// Toy tap effects: a squash-and-hop spring, a warm glow and a burst of stars.
// Textures are drawn on canvases, so there are no image files to load or license.

import * as THREE from "three";

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** White five-point star with a soft rim; sprites tint it. */
function starTexture() {
  return canvasTexture(64, (g, s) => {
    const r = s / 2;
    g.translate(r, r);
    g.shadowColor = "rgba(255,255,255,0.9)";
    g.shadowBlur = 6;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rad = i % 2 ? r * 0.38 : r * 0.82;
      g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
    g.fillStyle = "#ffffff";
    g.fill();
  });
}

/** Soft round glow, used behind a tapped toy. */
export function haloTexture() {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,236,170,0.8)");
    grad.addColorStop(0.25, "rgba(255,220,130,0.4)");
    grad.addColorStop(0.6, "rgba(255,205,110,0.08)");
    grad.addColorStop(1, "rgba(255,200,100,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

const COLORS = ["#ffcf3a", "#ff7fa8", "#5ccfff", "#a98bff", "#7be08a"];
const GRAVITY = 1.4; // m/s², gentler than real so the stars float

type Star = { sprite: THREE.Sprite; vel: THREE.Vector3; life: number; max: number; size: number; spin: number };

/** A fixed pool of star sprites; bursts reuse the oldest ones. */
export class Sparkles {
  readonly group = new THREE.Group();
  private stars: Star[] = [];
  private next = 0;

  constructor(count = 60) {
    const tex = starTexture();
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.visible = false;
      sprite.renderOrder = 10;
      this.group.add(sprite);
      this.stars.push({ sprite, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.04, spin: 0 });
    }
  }

  burst(at: THREE.Vector3, n = 18) {
    for (let j = 0; j < n; j++) {
      const s = this.stars[this.next];
      this.next = (this.next + 1) % this.stars.length;
      const a = Math.random() * Math.PI * 2;
      const out = 0.35 + Math.random() * 0.45;
      // mostly upwards and towards the viewer, so the burst reads from the front
      s.vel.set(Math.cos(a) * out, 0.55 + Math.random() * 0.7, Math.abs(Math.sin(a)) * out * 0.8 + 0.1);
      s.sprite.position.copy(at);
      s.max = s.life = 0.8 + Math.random() * 0.5;
      s.size = 0.045 + Math.random() * 0.045;
      s.spin = (Math.random() - 0.5) * 8;
      const m = s.sprite.material;
      m.color.set(COLORS[j % COLORS.length]);
      m.rotation = Math.random() * Math.PI;
      s.sprite.visible = true;
    }
  }

  update(dt: number) {
    for (const s of this.stars) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sprite.visible = false; continue; }
      s.vel.y -= GRAVITY * dt;
      s.vel.multiplyScalar(1 - 1.2 * dt); // air drag
      s.sprite.position.addScaledVector(s.vel, dt);
      const age = 1 - s.life / s.max;
      const pop = age < 0.15 ? age / 0.15 : 1; // grow in quickly, then shrink away
      s.sprite.scale.setScalar(s.size * pop * (1 - 0.5 * age));
      s.sprite.material.opacity = Math.min(1, (s.life / s.max) * 2.2);
      s.sprite.material.rotation += s.spin * dt;
    }
  }
}

/** Squash-and-stretch spring: x < 0 squashes the toy, x > 0 stretches it. */
export type Squash = { x: number; v: number; hop: number };

export function stepSquash(q: Squash, dt: number) {
  const K = 280, C = 9;
  q.v += (-K * q.x - C * q.v) * dt;
  q.x = THREE.MathUtils.clamp(q.x + q.v * dt, -0.4, 0.5);
  if (q.hop >= 0) q.hop += dt;
}

/** Height of the little jump after a tap: it starts once the squash has loaded up. */
export function hopHeight(t: number) {
  const start = 0.09, len = 0.42;
  if (t < start || t > start + len) return 0;
  return Math.sin(((t - start) / len) * Math.PI) * 0.06;
}
