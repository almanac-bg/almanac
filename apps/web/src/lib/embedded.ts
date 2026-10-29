import type { ChallengePreview } from '@quiz/shared';

/**
 * A challenge link's preview, as the server put it in the page (index.ts → challengePage): there at once, no request
 * to wait for. Only for the link the page is for.
 */
export function embeddedChallenge(id: string): ChallengePreview | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('challenge-preview');
  if (!el?.textContent) return null;
  try {
    const preview = JSON.parse(el.textContent) as ChallengePreview & { id?: string };
    return preview.id === id ? preview : null;
  } catch {
    return null;
  }
}
