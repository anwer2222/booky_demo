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
