/**
 * The first stop for a keyboard: straight to the page's content, past the header and its links (a full load of the
 * lobby took 11 Tabs to reach it on a desktop). Out of sight until it has the focus. A button: it moves the focus,
 * not the address.
 */
export function SkipLink() {
  return (
    <button
      type="button"
      onClick={() => document.getElementById('content')?.focus()}
      className="focus-ring sr-only z-50 rounded-xl bg-ink-2 px-4 py-3 font-semibold text-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Към съдържанието
    </button>
  );
}
