const CONFETTI_COLORS = ['#a78bfa', '#e879f9', '#22d3ee', '#fbbf24', '#34d399'];

/**
 * Its own canvas, under dialogs (z-50: the reward moment, „Ново ниво“) and over the page: the library's own sits at
 * z-index 100, over everything, and covered the dialog it was celebrating (the review's VD-6).
 */
let canvas: HTMLCanvasElement | null = null;
let instance: ReturnType<typeof import('canvas-confetti').create> | null = null;
function layer() {
  if (canvas?.isConnected) return canvas;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '40' });
  canvas.style.pointerEvents = 'none';
  document.body.append(canvas);
  return canvas;
}

/** Confetti for a win: its library loads when there's one to celebrate, not with the game. */
export function burst(power = 1) {
  void import('canvas-confetti').then(({ default: library }) => {
    // One instance per canvas: each clears the whole canvas as it draws.
    if (!instance || !canvas?.isConnected)
      instance = library.create(layer(), { resize: true, disableForReducedMotion: true });
    const confetti = instance;
    // Gone in about two seconds: longer, it lay over the result it celebrates.
    const opts = { colors: CONFETTI_COLORS, ticks: 120 };
    void confetti({
      ...opts,
      particleCount: Math.round(90 * power),
      spread: 75,
      origin: { y: 0.35 },
      startVelocity: 45,
    });
    setTimeout(() => {
      void confetti({
        ...opts,
        particleCount: Math.round(50 * power),
        angle: 60,
        spread: 60,
        origin: { x: 0, y: 0.6 },
      });
      void confetti({
        ...opts,
        particleCount: Math.round(50 * power),
        angle: 120,
        spread: 60,
        origin: { x: 1, y: 0.6 },
      });
    }, 250);
  });
}
