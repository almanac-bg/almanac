import { isQueueMode, type QueueModeId, type RematchState } from '@quiz/shared';
import { guarded } from '../guard';
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
    if (startable) this.matchmaker.startWith(offer.mode, userIds);
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
    const offer: Offer = {
      gameId: game.id,
      mode,
      players: new Map(stayed.map((p) => [p.player.id, p.player.userId!])),
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
    if (cancelled && offer.ready.size > 0) this.broadcast(offer, true);
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
