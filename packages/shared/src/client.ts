/**
 * Which client is talking to the server, and which version of the wire it speaks. The web reloads itself onto a new
 * build within moments (ReloadForUpdate); a store app can't, and a match mixes every player who queued, so an app
 * that can't follow the wire breaks the match for its player. Each client says what it is — the socket's `auth` and a
 * header on every /api request — and the server refuses one below its platform's minimum (MIN_PROTOCOL) with
 * `update-required`: the web reloads, the app asks for an update. docs/maintainers.md → Протокол says when PROTOCOL
 * goes up and in which order a new mechanic ships.
 */

/**
 * The wire's version: the socket events, their payloads and the REST shapes, as both clients read them. Raised when a
 * change is one an older client can't follow (a question kind every player can be dealt, a field renamed or removed);
 * a change that only adds doesn't raise it (CONTRIBUTING.md: the protocol only grows within one deploy).
 */
export const PROTOCOL = 1;

export const CLIENT_PLATFORMS = ['web', 'ios', 'android'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export interface ClientInfo {
  client: ClientPlatform;
  protocol: number;
  /** The client's own build: the web's commit, an app's version and build number. */
  build: string;
}

/** The header every /api request carries: "web 1 5c7bdf4". */
export const CLIENT_HEADER = 'x-almanac-client';

/**
 * An app's „this device has signed in to this account before“ (the web's is a cookie): what a sign-in gave it as
 * `session.device`, sent back to the sign-in addresses, so wrong passwords from elsewhere can't lock it out.
 */
export const DEVICE_HEADER = 'x-almanac-device';

/**
 * A new session, given to an app in the answer (`session`) instead of a cookie: it keeps both and sends them back,
 * the token as `Authorization: Bearer <token>` on /api and as `token` in the socket's `auth`.
 */
export interface AppSession {
  token: string;
  /** For DEVICE_HEADER; a guest's way in has none (there's no password to protect). */
  device?: string;
}

/** The refusal, as the socket's connect error and the /api answer's `code` (with HTTP 426). */
export const UPDATE_REQUIRED = 'update-required';

export const clientHeader = (info: ClientInfo) => `${info.client} ${info.protocol} ${info.build}`;

const isPlatform = (value: unknown): value is ClientPlatform => CLIENT_PLATFORMS.includes(value as ClientPlatform);
const BUILD = /^[\w.+-]{0,64}$/;

/** What a client said it is (the header's text, or the socket's `auth`), or null when it said nothing usable. */
export function parseClient(value: unknown): ClientInfo | null {
  if (typeof value === 'string') {
    const [client, protocol, build = '', ...rest] = value.trim().split(/\s+/);
    if (rest.length) return null;
    return parseClient({ client, protocol: Number(protocol), build });
  }
  if (!value || typeof value !== 'object') return null;
  const { client, protocol, build } = value as Record<string, unknown>;
  if (!isPlatform(client) || !Number.isInteger(protocol) || (protocol as number) < 0) return null;
  const text = typeof build === 'string' ? build : '';
  return BUILD.test(text) ? { client, protocol: protocol as number, build: text } : null;
}
