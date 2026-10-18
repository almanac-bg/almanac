/** Fixed ambient backdrop: drifting neon blobs, a faint grid and film grain. */
export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-[20vh] -left-[15vw] size-[60vw] max-w-[900px] animate-drift rounded-full bg-violet-600/25 blur-[120px]" />
      <div
        className="absolute top-[30vh] -right-[20vw] size-[55vw] max-w-[820px] animate-drift rounded-full bg-cyan-500/15 blur-[120px]"
        style={{ animationDelay: '-8s' }}
      />
      <div
        className="absolute -bottom-[25vh] left-[20vw] size-[50vw] max-w-[760px] animate-drift rounded-full bg-fuchsia-600/15 blur-[130px]"
        style={{ animationDelay: '-15s' }}
      />
      <div className="grid-lines absolute inset-0" />
      <div className="noise absolute inset-0 opacity-[0.07] mix-blend-overlay" />
    </div>
  );
}
