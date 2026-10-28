import clsx from 'clsx';

/**
 * Fixed ambient backdrop: neon blobs, a faint grid and film grain.
 *
 * It stands still on purpose. When the blobs drifted, every frame re-blurred three screen-sized layers, re-blended the
 * grain over them and re-blurred what's behind every glass card: an idle page kept a laptop's fans going (about half
 * a CPU core on an M4, a whole one with software drawing, and more on a 144 Hz screen). Still, it is drawn once.
 */
export function Background({ className }: { className?: string }) {
  return (
    <div aria-hidden className={clsx('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      <div className="absolute -top-[20vh] -left-[15vw] size-[60vw] max-w-[900px] rounded-full bg-violet-600/25 blur-[120px]" />
      <div className="absolute top-[30vh] -right-[20vw] size-[55vw] max-w-[820px] rounded-full bg-cyan-500/15 blur-[120px]" />
      <div className="absolute -bottom-[25vh] left-[20vw] size-[50vw] max-w-[760px] rounded-full bg-fuchsia-600/15 blur-[130px]" />
      <div className="grid-lines absolute inset-0" />
      <div className="noise absolute inset-0 opacity-[0.07] mix-blend-overlay" />
    </div>
  );
}
