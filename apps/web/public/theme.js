// The colour theme, before the page is first drawn (src/lib/theme.ts chooses and keeps it): a light device or a light
// choice never sees the dark theme flash first. A file of its own: the page's security policy runs no inline script.
(() => {
  try {
    const choice = localStorage.getItem('quiz:theme');
    const light = choice === 'light' || (choice === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    if (!light) return;
    document.documentElement.dataset.theme = 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f4f3f9');
  } catch {
    // No storage (a private window, blocked site data): the dark theme.
  }
})();
