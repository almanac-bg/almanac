/** On phones autofocus would pop the keyboard and scroll past the logo. */
export const DESKTOP = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
