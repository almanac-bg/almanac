/** Moments the shared game logic signals; the website plays a sound (and, on phones, a buzz) for them. */
export type Effect =
  | 'lock'
  /** A new question comes in. */
  | 'question'
  | 'correct'
  | 'wrong'
  /** The question ended without an answer of yours: out of time, not wrong. */
  | 'timeUp'
  | 'powerup'
  /** Someone else was knocked out ('knockedOut': you were). */
  | 'eliminated'
  | 'knockedOut'
  | 'achievement'
  | 'invite'
  | 'reaction'
  /** A round's category is decided. */
  | 'round'
  /** One on one, the lead changes hands: you took it, or lost it. */
  | 'leadTaken'
  | 'leadLost';

export interface ClientConfig {
  /** Server origin, e.g. "https://almanac.bg". Empty = same origin. */
  baseUrl: string;
  effect?: (name: Effect) => void;
  /** Fetches a question's picture ahead of it (the next question's, told during the reveal before it). */
  preload?: (image: { src: string; srcSet: string }) => void;
}

let config: ClientConfig = { baseUrl: '' };

/** Call once at startup, before connecting. */
export function configureClient(next: ClientConfig) {
  config = next;
}

export const clientConfig = () => config;

export const effect = (name: Effect) => config.effect?.(name);

export const preloadImage = (image: { src: string; srcSet: string } | null | undefined) => {
  if (image) config.preload?.(image);
};
