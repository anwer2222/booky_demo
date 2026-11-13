// Small synthesised chime for toy taps: no audio files, so nothing to license.
// Browsers only allow audio after a user gesture, so the context is created on the first tap.

let ctx: AudioContext | null = null;

export function playChime(seed = 0) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const base = [523.25, 587.33, 659.25, 783.99, 880][seed % 5];
    const t0 = ctx.currentTime;
    [base, base * 1.5].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = t0 + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  } catch {
    // audio unavailable: toys still spin
  }
}

/** Short rising "boing" for the toy squash. */
export function playBoing() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.16);
    osc.frequency.exponentialRampToValueAtTime(300, t0 + 0.3);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.35);
  } catch {
    // audio unavailable
  }
}

let noise: AudioBuffer | null = null;

/**
 * Paper page turn: filtered noise with two swells (the lift, then the page falling flat).
 * The cover is heavier: lower and with a soft thud at the end.
 */
export function playPageTurn(cover = false) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const c = ctx;
    if (!noise) {
      noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime;
    const len = cover ? 0.55 : 0.5;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4; // no two turns sound the same
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(cover ? 900 : 2600, t0);
    band.frequency.exponentialRampToValueAtTime(cover ? 300 : 900, t0 + len);
    const gain = c.createGain();
    const peak = cover ? 0.22 : 0.16;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak * 0.6, t0 + 0.06);
    gain.gain.exponentialRampToValueAtTime(peak * 0.25, t0 + len * 0.45);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + len * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(band).connect(gain).connect(c.destination);
    src.start(t0);
    src.stop(t0 + len + 0.05);
    if (cover) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(110, t0 + len * 0.8);
      osc.frequency.exponentialRampToValueAtTime(55, t0 + len + 0.15);
      g.gain.setValueAtTime(0.0001, t0 + len * 0.8);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + len * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.2);
      osc.connect(g).connect(c.destination);
      osc.start(t0 + len * 0.8);
      osc.stop(t0 + len + 0.25);
    }
  } catch {
    // audio unavailable
  }
}
