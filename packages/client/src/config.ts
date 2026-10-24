/** Moments the shared game logic signals; the website plays a sound for each. */
export type Effect =
  | 'lock'
  | 'correct'
  | 'wrong'
  | 'powerup'
  | 'freeze'
  | 'eliminated'
  | 'achievement'
  | 'invite'
  | 'reaction';

export interface ClientConfig {
  /** Server origin, e.g. "https://almanac.bg". Empty = same origin. */
  baseUrl: string;
  effect?: (name: Effect) => void;
}

let config: ClientConfig = { baseUrl: '' };

/** Call once at startup, before connecting. */
export function configureClient(next: ClientConfig) {
  config = next;
}

export const clientConfig = () => config;

export const effect = (name: Effect) => config.effect?.(name);
