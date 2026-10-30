import {
  type AckResult,
  type AnswerRejection,
  achievementById,
  type CategoryChoice,
  type CategoryId,
  type ClientToServerEvents,
  type GameStartPayload,
  type Invite,
  type PowerupId,
  powerupById,
  type QueueModeId,
  type RoomSettingsPatch,
  type ServerToClientEvents,
  type SoloPace,
} from '@quiz/shared';
import type { io as connect, Socket } from 'socket.io-client';
import { api } from './api';
import { clientConfig, effect, preloadImage } from './config';
import { getState, type LiveGame, patchGame, setState, signedOut, toast } from './store';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;
/** The realtime library, loaded when a session connects (a signed-out visitor's first page never needs it). */
let io: typeof connect | null = null;
let seq = 0;

/** What the player is told when the server didn't take an answer the screen showed as locked in. */
const REJECTED: Record<AnswerRejection, string> = {
  late: 'Отговорът ти пристигна след края на времето.',
  removed: 'Този отговор е премахнат от „50/50“ — избери друг.',
};
const nameOf = (g: LiveGame, playerId: string) => g.players[playerId]?.name ?? 'Някой';

/** The realtime connection, created on first use from the client config (once connectRealtime has loaded it). */
export function getSocket(): GameSocket {
  if (!socket) {
    if (!io) throw new Error('The realtime connection is not loaded yet.');
    // WebSocket first: starting with HTTP long-polling costs four round trips before the lobby is live (about half a
    // second on a phone). Polling stays the fallback where a WebSocket is blocked.
    socket = io(clientConfig().baseUrl || undefined, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
    });
    bind(socket);
  }
  return socket;
}

/** How soon a dropped connection tries again: Socket.IO's own 1 s, give or take half. */
const RECONNECT = { delayMs: 1000, jitter: 0.5 };
/**
 * …and after a restart the server announced (server:draining): anywhere in the first 5 s. Every open tab drops at the
 * same moment, and coming back in the same second too, thousands of them made the new server's first seconds stutter
 * (test/load.ts on 2000 players: up to half a second); spread out, it's a handful a millisecond.
 */
const AFTER_RESTART = { delayMs: 2500, jitter: 1 };

/** Wanted connected: a sign-out while the library was still loading doesn't connect it afterwards. */
let wanted = false;
export async function connectRealtime() {
  wanted = true;
  io ??= (await import('socket.io-client')).io;
  if (wanted) getSocket().connect();
}
export const disconnectRealtime = () => {
  wanted = false;
  socket?.disconnect();
};

/** After a reconnect the server re-sends live state right away; anything it doesn't re-send is gone. */
let resyncTimer: ReturnType<typeof setTimeout> | undefined;
/** After a mid-match resync: if no question follows, the one on screen closed while we were away. */
let staleQuestionTimer: ReturnType<typeof setTimeout> | undefined;
/** The match you walked out of: if the server still sends it (the leave crossed a reconnect), leave it again. */
let leftGameId: string | null = null;
/** Turned away for having too many connections open: said once, until a connection goes through. */
let crowded = false;

/** When the server was last heard from (any event, or its ping). */
let lastHeard = Date.now();
/** Silence longer than this is no quiet lobby: the server pings every 10 s (realtime.ts on the server). */
const SILENT_MS = 14_000;
/** A reveal comes within half a second of the clock running out; this much later, the link is likely gone. */
const REVEAL_OVERDUE_MS = 3_000;

/** Flags a link that went quiet while the socket still reads as connected (checked every second). */
function watchLink(s: GameSocket) {
  const heard = () => {
    lastHeard = Date.now();
    if (getState().stalled) setState({ stalled: false });
  };
  s.onAny(heard);
  s.io.on('ping', heard);
  s.on('connect', heard);
  // A tab back from the background (a locked phone) gets a fresh window: its timers were asleep, not the link.
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') lastHeard = Date.now();
    });
  const timer = setInterval(() => {
    const { connected, stalled, game } = getState();
    const now = Date.now();
    const overdue = game?.phase === 'question' && now > game.deadline + REVEAL_OVERDUE_MS && now - lastHeard > 2_000;
    const quiet = connected && (now - lastHeard > SILENT_MS || overdue);
    if (quiet !== stalled) setState({ stalled: quiet });
  }, 1000);
  // Node (the client's tests) shouldn't stay up for it.
  (timer as { unref?: () => void }).unref?.();
}

function bind(s: GameSocket) {
  watchLink(s);
  // Back online, or back on a tab that was asleep (a locked phone): try again at once. Left to itself, Socket.IO waits
  // out its own back-off first (14 s in Chrome and Safari), and in Firefox it never came back after a lost network
  // until the page was reloaded. Not after signing out: that socket was closed on purpose (`active` is false).
  if (typeof window !== 'undefined') {
    const retry = () => {
      if (!s.connected && s.active) s.disconnect().connect();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retry();
    });
  }
  s.on('connect', () => {
    crowded = false;
    s.io.reconnectionDelay(RECONNECT.delayMs).randomizationFactor(RECONNECT.jitter);
    const { game } = getState();
    setState({ connected: true, queue: null, room: null, maintenance: null });
    if (game && game.phase !== 'ended') {
      clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        const still = getState().game;
        if (still?.start.gameId === game.start.gameId && still.phase !== 'ended') {
          setState({ game: null });
          toast({ kind: 'error', title: 'Мачът беше прекъснат.' });
        }
      }, 2500);
    }
  });
  s.on('disconnect', (reason) => {
    setState({ connected: false, stalled: false });
    // The server closed this connection on purpose (logged out here or elsewhere): Socket.IO won't come back on its own.
    // Signed out → the sign-in page; still signed in → connect again.
    if (reason === 'io server disconnect') {
      api
        .me()
        .then(({ user }) => {
          setState({ me: user });
          if (user) s.connect();
        })
        .catch(() => setTimeout(() => s.connect(), 2000));
    }
  });
  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') signedOut();
    // The server's cap on open tabs. Socket.IO doesn't retry a refusal like this on its own: say why, and try again in a
    // while (a tab may have been closed by then).
    if (err.message === 'too-many-connections') {
      if (!crowded)
        toast(
          {
            kind: 'error',
            title: 'Играта е отворена в твърде много раздели.',
            body: 'Затвори излишните — свързваме се отново след малко.',
          },
          9000,
        );
      crowded = true;
      setTimeout(() => s.connect(), 10_000);
    }
  });

  s.on('lobby:stats', (lobby) => setState({ lobby }));

  s.on('queue:status', (queue) =>
    setState((st) => ({ queue, queueSince: queue && !st.queue ? Date.now() - queue.waitedMs : st.queueSince })),
  );

  s.on('room:state', (room) => setState((st) => ({ room, knock: room ? null : st.knock })));
  s.on('room:refused', ({ code, message }) =>
    setState((st) => (st.knock?.code === code ? { knock: { code, refused: message } } : {})),
  );

  s.on('evening:status', (evening) => setState({ evening }));

  s.on('rematch:state', (rematch) => {
    const mine = getState().game?.start;
    if (rematch.cancelled) {
      // Only news to someone who was waiting on it.
      if (mine && rematch.ready.includes(mine.youId)) toast({ kind: 'info', title: 'Реваншът няма да се състои.' });
      return setState((s) => ({ rematch: s.rematch?.gameId === rematch.gameId ? null : s.rematch }));
    }
    if (mine && !rematch.ready.includes(mine.youId)) effect('invite');
    setState({ rematch });
  });

  s.on('game:start', (start) => {
    clearTimeout(resyncTimer);
    if (start.gameId === leftGameId) {
      s.emit('game:leave');
      return;
    }
    const prev = getState().game;
    preloadImage(start.nextImage);
    if (prev?.start.gameId === start.gameId && start.startsInMs === 0) return resync(prev, start);
    const now = Date.now();
    setState({
      queue: null,
      rematch: null,
      game: {
        start,
        players: Object.fromEntries(start.players.map((p) => [p.id, p])),
        standings: start.standings,
        phase: start.startsInMs > 0 ? 'countdown' : 'reveal',
        countdownEndsAt: now + start.startsInMs,
        question: null,
        deadline: now,
        answered: [],
        myChoice: null,
        myGuess: null,
        myOrder: null,
        removed: [],
        doubled: false,
        usedPowerups: start.usedPowerups,
        powerupThisQuestion: false,
        retryArmed: false,
        retryPrompt: false,
        reveal: null,
        paused: null,
        resyncing: false,
        rounds: start.rounds,
        pick: null,
        eliminated: start.standings.filter((x) => x.eliminatedAt !== null).map((x) => x.id),
        reactions: [],
        feed: [],
        history: [],
        end: null,
      },
    });
  });

  s.on('game:question', (question) => {
    clearTimeout(staleQuestionTimer);
    const g = getState().game;
    if (!g) return;
    // Back after the link died: questions went by meanwhile (a tunnel is noticed only when the ping times out).
    const missed = g.question ? question.index - g.question.index - 1 : 0;
    if (missed > 0) {
      toast({
        kind: 'info',
        title:
          missed === 1 ? 'Докато нямаше връзка, мина 1 въпрос.' : `Докато нямаше връзка, минаха ${missed} въпроса.`,
      });
    }
    const same = g.question?.index === question.index && g.phase === 'question' ? g : null;
    if (!same) effect('question');
    // A resync after a reconnect says where you stand on the question (a fresh tab knows nothing of it): the server's
    // word goes.
    const mine = question.mine;
    if (mine) {
      const lost = mine.choice === null && mine.guess === null && !mine.order;
      if (same && same.myChoice !== null && lost && question.remainingMs > 0) {
        toast({
          kind: 'error',
          title: 'Отговорът ти не стигна до сървъра.',
          body: 'Избери отново — времето още тече.',
        });
      }
      const now = Date.now();
      patchGame(() => ({
        phase: 'question',
        question,
        deadline: now + question.remainingMs,
        answered: question.answered,
        myChoice: mine.guess !== null || mine.order ? -1 : mine.choice,
        myGuess: mine.guess,
        myOrder: mine.order ?? null,
        removed: mine.removed,
        doubled: mine.doubled,
        powerupThisQuestion: mine.powerupThisQuestion,
        retryArmed: mine.retryArmed,
        retryPrompt: mine.retryPrompt,
        reveal: null,
        resyncing: false,
        pick: null,
      }));
      return;
    }
    const lockedIn = question.answered.includes(g.start.youId);
    if (same && same.myChoice !== null && !lockedIn && question.remainingMs > 0) {
      toast({ kind: 'error', title: 'Отговорът ти не стигна до сървъра.', body: 'Избери отново — времето още тече.' });
    }
    patchGame(() => ({
      phase: 'question',
      question,
      deadline: Date.now() + question.remainingMs,
      answered: question.answered,
      myChoice: lockedIn ? (same?.myChoice ?? -1) : null,
      myGuess: lockedIn ? (same?.myGuess ?? null) : null,
      myOrder: lockedIn ? (same?.myOrder ?? null) : null,
      removed: same?.removed ?? [],
      doubled: same?.doubled ?? false,
      powerupThisQuestion: same?.powerupThisQuestion ?? false,
      retryArmed: same?.retryArmed ?? false,
      retryPrompt: !lockedIn && !!same?.retryPrompt,
      reveal: null,
      resyncing: false,
      pick: null,
    }));
  });

  s.on('game:answered', ({ playerId }) => patchGame((g) => ({ answered: [...g.answered, playerId] })));

  // The screen showed the pick as locked in; it wasn't taken. Unlock it (if the question is still open) and say why.
  s.on('game:rejected', ({ index, reason }) => {
    const g = getState().game;
    if (!g?.question || g.question.index !== index) return;
    if (g.phase === 'question') patchGame(() => ({ myChoice: null, myGuess: null, myOrder: null }));
    toast({ kind: 'error', title: REJECTED[reason] });
  });

  s.on('game:retry', ({ wrong }) => {
    effect('wrong');
    patchGame((g) => ({ myChoice: null, retryPrompt: true, removed: [...g.removed, wrong] }));
  });

  s.on('game:paused', ({ index, paused }) => patchGame(() => ({ paused: paused ? index : null })));

  s.on('game:reveal', (reveal) => {
    const before = getState().game;
    patchGame((g) => {
      const q = g.question;
      const mine = reveal.results[g.start.youId];
      const recorded = !q || q.index !== reveal.index || g.history.some((h) => h.index === reveal.index);
      return {
        phase: 'reveal',
        reveal,
        // The pick that counted is the server's: one made in another tab of the same player was the one taken, and
        // this tab's own tap (ignored) mustn't show as "твоят избор".
        ...(mine && q?.index === reveal.index && q.kind === 'choice' ? { myChoice: mine.choice } : {}),
        resyncing: false,
        retryPrompt: false,
        standings: reveal.standings,
        eliminated: [...g.eliminated, ...reveal.eliminated],
        history: recorded
          ? g.history
          : [
              ...g.history,
              {
                id: q.id,
                index: q.index,
                q: q.q,
                options: q.options,
                category: q.category,
                difficulty: q.difficulty,
                correct: reveal.correct,
                choice: mine?.choice ?? null,
                number:
                  q.number && reveal.answerNumber !== undefined
                    ? {
                        answer: reveal.answerNumber,
                        unit: q.number.unit,
                        step: q.number.step,
                        scale: q.number.scale,
                        guess: mine?.number?.guess ?? null,
                        closeness: mine?.number?.closeness ?? 0,
                      }
                    : null,
                order:
                  q.order && reveal.answerOrder
                    ? {
                        items: q.order.items,
                        right: reveal.answerOrder.order,
                        given: mine?.order?.given ?? null,
                        values: reveal.answerOrder.values,
                        unit: reveal.answerOrder.unit,
                        placed: mine?.order?.right ?? 0,
                      }
                    : null,
                // From a server before pictures: none.
                image: q.image ? { ...q.image, credit: reveal.credit ?? null } : null,
                right: !!mine?.correct,
                fact: reveal.fact ?? null,
                // From a server before „X% знаят“: none.
                crowd: reveal.crowd ?? null,
              },
            ],
      };
    });
    preloadImage(reveal.nextImage);
    const g = getState().game;
    if (!g) return;
    const mine = reveal.results[g.start.youId];
    // No answer at all (no option, number or order in time) is the clock's, not a wrong answer.
    const none =
      mine &&
      (mine.number ? mine.number.guess === null : mine.order ? mine.order.given === null : mine.choice === null);
    if (mine) effect(mine.correct ? 'correct' : none ? 'timeUp' : 'wrong');
    // One on one: who leads now, if that changed (a tie leads nobody).
    if (before && g.start.players.length === 2) {
      const leader = (standings: typeof g.standings) =>
        standings[0] && standings[0].score > (standings[1]?.score ?? 0) ? standings[0].id : null;
      const was = leader(before.standings);
      const now = leader(reveal.standings);
      if (now && was !== now) setTimeout(() => effect(now === g.start.youId ? 'leadTaken' : 'leadLost'), 450);
    }
    if (reveal.eliminated.length)
      setTimeout(() => effect(reveal.eliminated.includes(g.start.youId) ? 'knockedOut' : 'eliminated'), 900);
  });

  // A round's category is being picked: by you, or by someone you wait for.
  s.on('game:pick', (pick) => {
    clearTimeout(staleQuestionTimer);
    patchGame(() => ({
      phase: 'pick',
      pick: { ...pick, endsAt: Date.now() + pick.remainingMs, sent: null, chosen: null },
      resyncing: false,
    }));
  });

  s.on('game:round', ({ round, category, pickedBy, nextImage }) => {
    preloadImage(nextImage);
    patchGame((g) => ({
      rounds: g.rounds.map((r, i) => (i === round ? { ...r, category, pickedBy } : r)),
      pick: g.pick?.round === round ? { ...g.pick, chosen: category } : g.pick,
    }));
    effect('round');
  });

  s.on('game:powerup', ({ playerId, powerup, removed }) => {
    const g = getState().game;
    if (!g) return;
    const def = powerupById(powerup);
    const you = g.start.youId;

    if (playerId === you) {
      effect('powerup');
      patchGame((x) => ({
        usedPowerups: [...x.usedPowerups, powerup],
        powerupThisQuestion: true,
        removed: removed ?? x.removed,
        doubled: x.doubled || powerup === 'double',
        retryArmed: x.retryArmed || powerup === 'retry',
      }));
    }
    if (playerId !== you) pushFeed(`${nameOf(g, playerId)} използва „${def?.name ?? powerup}“`, def?.icon ?? '🃏');
  });

  s.on('game:reaction', ({ playerId, emote }) => {
    const key = ++seq;
    effect('reaction');
    patchGame((g) => ({ reactions: [...g.reactions, { key, playerId, emote }] }));
    setTimeout(() => patchGame((g) => ({ reactions: g.reactions.filter((r) => r.key !== key) })), 2600);
  });

  s.on('game:presence', ({ playerId, connected, left }) =>
    patchGame((g) => ({ standings: g.standings.map((x) => (x.id === playerId ? { ...x, connected, left } : x)) })),
  );

  s.on('game:end', (end) => {
    const g = getState().game;
    if (!g || g.start.gameId !== end.gameId) return;
    patchGame(() => ({ phase: 'ended', end, standings: end.standings }));
    void refreshMe();
  });

  // A one-attempt run we cut short: no result to show, and the attempt can be played again.
  s.on('game:aborted', ({ gameId, message }) => {
    if (getState().game?.start.gameId !== gameId) return;
    setState({ game: null });
    toast({ kind: 'info', title: message });
    void refreshMe();
  });

  // Presence changes arrive often; they carry the request count, so no profile reload is needed.
  s.on('friends:update', ({ requests }) =>
    setState((st) => ({
      friendsVersion: st.friendsVersion + 1,
      me: st.me && st.me.friendRequests !== requests ? { ...st.me, friendRequests: requests } : st.me,
    })),
  );

  s.on('invite', (invite) => {
    effect('invite');
    setState((st) => ({ invites: [...st.invites.filter((i) => i.from.id !== invite.from.id), invite] }));
    setTimeout(() => dropInvite(invite.id), Math.max(0, invite.expiresAt - Date.now()));
  });

  s.on('achievements', (ids) => {
    effect('achievement');
    for (const id of ids) {
      const a = achievementById(id);
      if (a) toast({ kind: 'success', icon: a.icon, title: `Ново постижение: ${a.name}`, body: `+${a.xp} XP` }, 6000);
    }
    void refreshMe();
  });

  s.on('account:update', () => void refreshMe());

  // Kept on the server until seen (the bell's list); said at once to whoever's here.
  s.on('notification', ({ item, unread }) => {
    toast({ kind: 'info', icon: item.icon, title: item.text }, 6000);
    setState((st) => ({ me: st.me && { ...st.me, unreadNotifications: unread } }));
  });

  s.on('notice', ({ kind, message }) => toast({ kind, title: message }));

  s.on('server:draining', ({ message }) => {
    setState({ maintenance: message });
    s.io.reconnectionDelay(AFTER_RESTART.delayMs).randomizationFactor(AFTER_RESTART.jitter);
  });
}

/**
 * The server re-sent the match on screen: we reconnected mid-match. Keep what's on screen (the question, your pick,
 * the review so far) and take the server's word for the rest. The question stays locked until the server confirms
 * it's still open: it may have closed while we were away.
 */
function resync(prev: LiveGame, start: GameStartPayload) {
  setState({
    game: {
      ...prev,
      start,
      players: Object.fromEntries(start.players.map((p) => [p.id, p])),
      standings: start.standings,
      usedPowerups: start.usedPowerups,
      rounds: start.rounds,
      eliminated: start.standings.filter((x) => x.eliminatedAt !== null).map((x) => x.id),
      resyncing: true,
    },
  });
  // An open question arrives right behind this. If none does, the round ended while we were away.
  clearTimeout(staleQuestionTimer);
  staleQuestionTimer = setTimeout(
    () =>
      patchGame((g) =>
        g.phase === 'question' || g.phase === 'countdown'
          ? { phase: 'reveal', question: null, resyncing: false }
          : { resyncing: false },
      ),
    1000,
  );
}

function pushFeed(text: string, icon: string) {
  const key = ++seq;
  patchGame((x) => ({ feed: [...x.feed, { key, text, icon }] }));
  setTimeout(() => patchGame((x) => ({ feed: x.feed.filter((f) => f.key !== key) })), 3200);
}

export function dropInvite(id: string) {
  setState((s) => ({ invites: s.invites.filter((i) => i.id !== id) }));
}

export async function refreshMe() {
  try {
    const { user } = await api.me();
    if (user) setState({ me: user });
  } catch {
    /* keep the old copy */
  }
}

async function ask<T extends object = object>(fn: () => Promise<AckResult<T>>): Promise<AckResult<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: 'Сървърът не отговаря. Провери връзката си.' };
  }
}

const withTimeout = () => getSocket().timeout(8000);

type MoveEvent = 'game:answer' | 'game:guess' | 'game:order' | 'game:pick' | 'game:powerup' | 'game:react';

/**
 * Sends a game move only over a live connection. Socket.IO would buffer a move made offline and replay it after the
 * reconnect, when its question is over (or worse, still open after the player has seen the state change).
 * Returns whether it went out.
 */
function sendMove<E extends MoveEvent>(event: E, ...args: Parameters<ClientToServerEvents[E]>): boolean {
  const s = getSocket();
  if (!s.connected) return false;
  // A link that died silently (ping overdue) still reads as connected; Socket.IO then buffers instead of sending.
  const buffered = s.sendBuffer.length;
  s.emit(event, ...args);
  if (s.sendBuffer.length === buffered) return true;
  s.sendBuffer.length = buffered;
  return false;
}

let offlineToastAt = 0;
function offlineToast(title: string) {
  if (Date.now() - offlineToastAt < 3000) return; // mashing a key shouldn't stack them
  offlineToastAt = Date.now();
  toast({ kind: 'error', title, body: 'Няма връзка със сървъра — опитваме отново.' });
}

export const actions = {
  joinQueue: (mode: QueueModeId) => ask(() => withTimeout().emitWithAck('queue:join', mode)),
  leaveQueue: () => {
    getSocket().emit('queue:leave');
    setState({ queue: null });
  },
  startSolo: (category: CategoryChoice, pace: SoloPace = 'normal') =>
    ask(() => withTimeout().emitWithAck('solo:start', { category, pace })),
  /** The evening Роял's lobby: in (while it's open), or out. */
  joinEvening: () => ask(() => withTimeout().emitWithAck('evening:join')),
  leaveEvening: () => {
    getSocket().emit('evening:leave');
    setState((st) => ({ evening: st.evening && { ...st.evening, joined: false } }));
  },
  /** „Поправителен“: the missed questions that have come back. */
  startReview: () => ask(() => withTimeout().emitWithAck('review:start')),
  /** `via`: the code of the daily link it was opened from. */
  startDaily: (via?: string) => ask(() => withTimeout().emitWithAck('daily:start', { via })),
  /** Plays a challenge link, or (no id) makes a new one and plays it first. */
  startChallenge: (id?: string) => ask<{ id: string }>(() => withTimeout().emitWithAck('challenge:start', { id })),
  /**
   * A duel with a friend: you play it now, they within a day. `categories`: a rematch's three rounds, when you lost the
   * last one.
   */
  startDuel: (friendId: number, categories?: CategoryId[]) =>
    ask<{ id: string }>(() => withTimeout().emitWithAck('challenge:start', { rival: friendId, categories })),
  requestRematch: (gameId: string) => getSocket().emit('rematch:request', { gameId }),
  /** Leaving the results screen: the others shouldn't wait for a rematch that won't come. */
  declineRematch: (gameId: string) => {
    getSocket().emit('rematch:decline', { gameId });
    setState({ rematch: null });
  },
  createRoom: (settings: RoomSettingsPatch = {}) =>
    ask<{ code: string }>(() => withTimeout().emitWithAck('room:create', settings)),
  /**
   * `nickname`: what a guest goes by in the room (a guest has to give one). `waiting`: the room is locked, and you're
   * at its door (`knock`) until the host decides.
   */
  joinRoom: async (code: string, nickname?: string) => {
    const res = await ask<{ code: string; waiting?: boolean }>(() =>
      withTimeout().emitWithAck('room:join', nickname === undefined ? code : { code, nickname }),
    );
    if (res.ok && res.waiting) setState({ knock: { code: res.code, refused: null } });
    return res;
  },
  /** Out of the room, or away from the door of a locked one. */
  leaveRoom: () => {
    getSocket().emit('room:leave');
    setState({ room: null, knock: null });
  },
  /** What the host changes: settings as they are, but a set by its id (null: the bank's questions). */
  roomSettings: (settings: RoomSettingsPatch) => getSocket().emit('room:settings', settings),
  roomBot: (action: 'add' | 'remove') => getSocket().emit('room:bot', action),
  roomKick: (playerId: string) => getSocket().emit('room:kick', playerId),
  roomLock: (locked: boolean) => getSocket().emit('room:lock', locked),
  /** The host lets someone at the locked room's door in, or doesn't. */
  roomAdmit: (playerId: string, admit: boolean) =>
    ask(() => withTimeout().emitWithAck('room:admit', { playerId, admit })),
  /** The host gives a guest's seat a plain „Играч N“. */
  roomRename: (playerId: string) => getSocket().emit('room:rename', playerId),
  roomTeam: (playerId: string) => getSocket().emit('room:team', playerId),
  startRoom: () => ask(() => withTimeout().emitWithAck('room:start')),
  invite: (userId: number) => ask(() => withTimeout().emitWithAck('invite:send', { userId })),
  /** Отбори with a friend: ask them; once they say yes, the two of you wait in the queue together. */
  inviteDuo: (userId: number) => ask(() => withTimeout().emitWithAck('duo:invite', { userId })),
  acceptDuo: (inviteId: string) => ask(() => withTimeout().emitWithAck('duo:accept', { inviteId })),
  declineInvite: (invite: Invite) => {
    getSocket().emit('invite:decline', { inviteId: invite.id });
    dropInvite(invite.id);
  },
  answer: (choice: number) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.resyncing || g.myChoice !== null || g.removed.includes(choice))
      return;
    if (g.question.kind === 'number') return;
    if (!sendMove('game:answer', { index: g.question.index, choice })) return offlineToast('Отговорът не е изпратен.');
    effect('lock');
    patchGame(() => ({ myChoice: choice, retryPrompt: false }));
  },
  /** Your order, on an order question: the shown items' indices, first to last. */
  arrange: (order: number[]) => {
    const g = getState().game;
    if (g?.question?.kind !== 'order' || g.phase !== 'question' || g.resyncing || g.myChoice !== null) return;
    if (!sendMove('game:order', { index: g.question.index, order })) return offlineToast('Отговорът не е изпратен.');
    effect('lock');
    patchGame(() => ({ myChoice: -1, myOrder: [...order] }));
  },
  /** Your number, on a number question. */
  guess: (value: number) => {
    const g = getState().game;
    if (g?.question?.kind !== 'number' || g.phase !== 'question' || g.resyncing || g.myChoice !== null) return;
    if (!sendMove('game:guess', { index: g.question.index, value })) return offlineToast('Отговорът не е изпратен.');
    effect('lock');
    patchGame(() => ({ myChoice: -1, myGuess: value }));
  },
  /** The next round's category, when you're the one picking it. */
  pickCategory: (category: CategoryId) => {
    const g = getState().game;
    const pick = g?.pick;
    if (g?.phase !== 'pick' || !pick || pick.pickerId !== g.start.youId || pick.sent || pick.chosen) return;
    if (!sendMove('game:pick', { round: pick.round, category })) return offlineToast('Изборът не е изпратен.');
    effect('lock');
    patchGame((x) => ({ pick: x.pick && { ...x.pick, sent: category } }));
  },
  powerup: (powerup: PowerupId) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.resyncing || g.myChoice !== null) return;
    if (g.usedPowerups.includes(powerup) || g.powerupThisQuestion) return;
    if (!sendMove('game:powerup', { index: g.question.index, powerup })) offlineToast('Козът не е изигран.');
  },
  /**
   * Stop on the revealed question's fact to read it (a run played alone): the next question waits for resumeAfterFact.
   * Resolves to whether the server took it (it may have moved on already).
   */
  holdOnFact: async (index: number) => (await ask(() => withTimeout().emitWithAck('game:hold', { index }))).ok,
  resumeAfterFact: () => getSocket().emit('game:resume'),
  /** The big screen's host sets a class's pace on a reveal: hold the next question, or bring it on now. */
  steer: async (index: number, action: 'pause' | 'next') =>
    (await ask(() => withTimeout().emitWithAck('game:steer', { index, action }))).ok,
  /** Emotes are for the moment: one that can't go out now is dropped. */
  react: (emote: string) => void sendMove('game:react', emote),
  /** Unlike a move, a leave made offline should still land after the reconnect, so this one may queue. */
  leaveGame: () => {
    leftGameId = getState().game?.start.gameId ?? null;
    getSocket().emit('game:leave');
    setState({ game: null });
  },
  /** Drop a finished game's state (results screen dismissed). */
  closeGame: () => setState({ game: null }),
};
