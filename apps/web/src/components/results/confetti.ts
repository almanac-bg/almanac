import confetti from 'canvas-confetti';

const CONFETTI_COLORS = ['#a78bfa', '#e879f9', '#22d3ee', '#fbbf24', '#34d399'];

export function burst(power = 1) {
  const opts = { colors: CONFETTI_COLORS, disableForReducedMotion: true };
  void confetti({ ...opts, particleCount: Math.round(90 * power), spread: 75, origin: { y: 0.35 }, startVelocity: 45 });
  setTimeout(() => {
    void confetti({ ...opts, particleCount: Math.round(50 * power), angle: 60, spread: 60, origin: { x: 0, y: 0.6 } });
    void confetti({ ...opts, particleCount: Math.round(50 * power), angle: 120, spread: 60, origin: { x: 1, y: 0.6 } });
  }, 250);
}
