import { isQueueMode, type QueueModeId, type RematchState } from '@quiz/shared';
import { guarded } from '../guard';
import { notify } from '../notifications';
import { getUser } from '../users';
import type { Game } from './Game';
import type { IO } from './io';
import type { Matchmaker } from './matchmaking';
import type { GameRegistry } from './registry';

/** How long after a match its players can ask for a rematch. */
const REMATCH_MS = 60_000;

interface Offer {
  gameId: string;
  mode: QueueModeId;
  /** Player id in the match → user id. */
  players: Map<string, number>;
  /** Who goes into the queue together (Отбори: each pair stays a pair). */
  parties: number[][];
  ready: Set<string>;
  timer: NodeJS.Timeout;
}

/**
 * "Реванш": after a ranked match with other people, the same people can play again — it starts once all of them ask.
 * Anyone declining, leaving for something else, or a minute passing ends the offer.
 */
export class Rematches {
  private offers = new Map<string, Offer>();

  constructor(
    private io: IO,
    private games: GameRegistry,
    private matchmaker: Matchmaker,
    private canStart: () => boolean,
    private isOnline: (userId: number) => boolean,
  ) {
    games.onClosed((game) => this.offer(game));
  }

  request(userId: number, gameId: string) {
    const offer = this.offers.get(gameId);
    const playerId = `u${userId}`;
    if (!offer?.players.has(playerId)) return;
    offer.ready.add(playerId);
    if (offer.ready.size < offer.players.size) return this.broadcast(offer, false);

    const userIds = [...offer.players.values()];
    const startable = this.canStart() && userIds.every((id) => this.isOnline(id) && !this.games.forUser(id));
    this.close(offer, !startable);
    if (startable) this.matchmaker.startWith(offer.mode, offer.parties);
  }

  decline(userId: number, gameId: string) {
    const offer = this.offers.get(gameId);
    if (offer?.players.has(`u${userId}`)) this.close(offer, true);
  }

  /** The player went on to something else (a queue, a room, another match): their offers are off. */
  cancelFor(userId: number) {
    for (const offer of this.offers.values()) if (offer.players.has(`u${userId}`)) this.close(offer, true);
  }

  private offer(game: Game) {
    const { mode, ranked } = game.setup;
    if (!ranked || !isQueueMode(mode)) return;
    const stayed = game.humans.filter((p) => !p.left && p.player.userId !== null);
    if (stayed.length < 2) return;
    // Отбори: the same pairs again, so only while both of each pair are still here.
    const parties = game.setup.teams
      ? [0, 1]
          .map((team) => stayed.filter((p) => p.player.team === team).map((p) => p.player.userId!))
          .filter((p) => p.length)
      : stayed.map((p) => [p.player.userId!]);
    if (game.setup.teams && parties.some((p) => p.length !== 2)) return;
    const offer: Offer = {
      gameId: game.id,
      mode,
      players: new Map(stayed.map((p) => [p.player.id, p.player.userId!])),
      parties,
      ready: new Set(),
      timer: setTimeout(
        guarded('rematch expiry', () => this.close(offer, true)),
        REMATCH_MS,
      ),
    };
    offer.timer.unref();
    this.offers.set(game.id, offer);
  }

  private close(offer: Offer, cancelled: boolean) {
    clearTimeout(offer.timer);
    this.offers.delete(offer.gameId);
    // Only worth telling when someone had asked: otherwise nobody is waiting on it.
    if (cancelled && offer.ready.size > 0) {
      this.broadcast(offer, true);
      this.tellTheAway(offer);
    }
  }

  /** Whoever had already gone (closed the app) learns later that someone wanted another round with them. */
  private tellTheAway(offer: Offer) {
    const askers = [...offer.ready].map((id) => getUser(offer.players.get(id)!)?.username).filter((n) => !!n);
    if (!askers.length) return;
    const who = askers.length === 1 ? askers[0] : `${askers[0]} и още ${askers.length - 1}`;
    for (const [playerId, userId] of offer.players) {
      if (offer.ready.has(playerId) || this.isOnline(userId)) continue;
      notify(userId, {
        icon: '🔁',
        text: `${who} ${askers.length === 1 ? 'поиска' : 'поискаха'} реванш, но теб вече те нямаше.`,
        link: askers.length === 1 ? `/profile/${encodeURIComponent(askers[0]!)}` : null,
      });
    }
  }

  private broadcast(offer: Offer, cancelled: boolean) {
    const state: RematchState = {
      gameId: offer.gameId,
      ready: [...offer.ready],
      players: [...offer.players.keys()],
      cancelled,
    };
    for (const userId of offer.players.values()) this.io.to(`user:${userId}`).emit('rematch:state', state);
  }
}
