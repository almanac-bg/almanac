import type { GamePlayer } from '@almanac/shared';

export type RematchStatus = 'open' | 'invited' | 'waiting' | 'over';

/** The rematch offer after a ranked match with other people, as a results screen holds it. */
export interface Rematch {
  status: RematchStatus;
  /** The other humans who stayed to the end: the rematch is with them. */
  opponents: GamePlayer[];
  /** Of them, who already asked. */
  ready: Set<string>;
  /**
   * Whose side the others were on: `with` you (a team match with only your teammates left — one more match together,
   * not a rematch against them), `mixed` (teammates and opponents), or `against` you.
   */
  sides: 'with' | 'mixed' | 'against';
  /** Local time the offer runs out. */
  until: number;
  /** You asked, or someone asked you: worth saying so when it falls through. */
  involved: boolean;
  request: () => void;
}

/** The server keeps an offer open for a minute after the match; the clock here starts a moment later, so a bit less. */
export const REMATCH_OFFER_MS = 58_000;
/** Asked, but the server never answered: the offer was already gone (it doesn't say so when nobody had asked yet). */
export const REMATCH_NO_ANSWER_MS = 4000;

/** "Мария", "Мария и Иван", "Мария и още 3". */
export function names(players: { name: string }[]) {
  if (players.length <= 2) return players.map((p) => p.name).join(' и ');
  return `${players[0]!.name} и още ${players.length - 1}`;
}

/** What the offer says: what's happening (`title`), how it starts (`detail`), and its button (none: nothing to press). */
export function rematchLines(r: Rematch): { title: string; detail: string; button: string | null } {
  const readyPlayers = r.opponents.filter((p) => r.ready.has(p.id));
  const pending = r.opponents.filter((p) => !r.ready.has(p.id));
  const invited = r.status === 'invited';
  // Teammates aren't opponents: with them it's one more match side by side.
  const sameSide = r.sides === 'with';
  const title =
    r.status === 'over'
      ? sameSide
        ? 'Още един мач няма да има.'
        : 'Реваншът няма да се състои.'
      : r.status === 'waiting'
        ? `Чакаме ${names(pending)}…`
        : invited
          ? `${names(readyPlayers)} ${readyPlayers.length === 1 ? 'иска' : 'искат'} ${sameSide ? 'още един мач' : 'реванш'}!`
          : sameSide
            ? 'Още един мач заедно?'
            : r.sides === 'mixed'
              ? 'Реванш със същите играчи?'
              : r.opponents.length === 1
                ? `Реванш срещу ${r.opponents[0]!.name}?`
                : 'Реванш със същите съперници?';
  const detail =
    r.status === 'waiting'
      ? 'Мачът започва, щом всички поискат'
      : invited && pending.length === 0
        ? 'Приеми и мачът започва веднага'
        : 'Започва, щом всички поискат';
  const button =
    r.status === 'waiting' || r.status === 'over' ? null : invited ? 'Приеми' : sameSide ? 'Още един' : 'Реванш';
  return { title, detail, button };
}
