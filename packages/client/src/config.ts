import { type ClientInfo, type ClientPlatform, PROTOCOL } from '@almanac/shared';

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
  /** What this client is, said to the server with every request and connection (packages/shared → client.ts). */
  client?: ClientPlatform;
  /** Its own build: the web's commit (the page's app-build), an app's version. */
  build?: string;
  /**
   * The server no longer takes this client's protocol (`update-required`): the web reloads onto the new build, an app
   * asks for an update. Nothing else works until then.
   */
  onUpdateRequired?: () => void;
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

/** This client, as it tells the server (packages/shared → parseClient reads it). */
export const clientInfo = (): ClientInfo => ({
  client: config.client ?? 'web',
  protocol: PROTOCOL,
  build: config.build ?? '',
});

/** Said once per page: every request after the refusal would only say it again. */
let updateAsked = false;
export function updateRequired() {
  if (updateAsked) return;
  updateAsked = true;
  config.onUpdateRequired?.();
}

export const effect = (name: Effect) => config.effect?.(name);

export const preloadImage = (image: { src: string; srcSet: string } | null | undefined) => {
  if (image) config.preload?.(image);
};
