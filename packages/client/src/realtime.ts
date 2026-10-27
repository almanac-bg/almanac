import {
  type AckResult,
  type AnswerRejection,
  achievementById,
  type CategoryChoice,
  type ClientToServerEvents,
  type GameStartPayload,
  type Invite,
  type PowerupId,
  powerupById,
  type QueueModeId,
  type RoomSettings,
  type ServerToClientEvents,
} from '@quiz/shared';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import { clientConfig, effect } from './config';
import { getState, type LiveGame, patchGame, setState, toast } from './store';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;
let seq = 0;

/** What the player is told when the server didn't take an answer the screen showed as locked in. */
const REJECTED: Record<AnswerRejection, string> = {
  late: 'Отговорът ти пристигна след края на времето.',
  removed: 'Този отговор е премахнат от „50/50“ — избери друг.',
  frozen: 'Замразен си — изчакай да се размразиш.',
};
const nameOf = (g: LiveGame, playerId: string) => g.players[playerId]?.name ?? 'Някой';

/** The realtime connection, created on first use from the client config. */
export function getSocket(): GameSocket {
  if (!socket) {
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

export const connectRealtime = () => getSocket().connect();
export const disconnectRealtime = () => socket?.disconnect();

/** After a reconnect the server re-sends live state right away; anything it doesn't re-send is gone. */
let resyncTimer: ReturnType<typeof setTimeout> | undefined;
/** After a mid-match resync: if no question follows, the one on screen closed while we were away. */
let staleQuestionTimer: ReturnType<typeof setTimeout> | undefined;
/** The match you walked out of: if the server still sends it (the leave crossed a reconnect), leave it again. */
let leftGameId: string | null = null;
/** Turned away for having too many connections open: said once, until a connection goes through. */
let crowded = false;

function bind(s: GameSocket) {
  s.on('connect', () => {
    crowded = false;
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
    setState({ connected: false });
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
    if (err.message === 'unauthorized') setState({ me: null });
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

  s.on('room:state', (room) => setState({ room }));

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
        extraMs: 0,
        answered: [],
        myChoice: null,
        removed: [],
        doubled: false,
        usedPowerups: start.usedPowerups,
        powerupThisQuestion: false,
        retryArmed: false,
        retryPrompt: false,
        frozenUntil: 0,
        frozenBy: null,
        reveal: null,
        resyncing: false,
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
    const same = g.question?.index === question.index && g.phase === 'question' ? g : null;
    // A resync after a reconnect says where you stand on the question (a fresh tab knows nothing of it): the server's
    // word goes, including the extra time already in `remainingMs`.
    const mine = question.mine;
    if (mine) {
      if (same && same.myChoice !== null && mine.choice === null && question.remainingMs > 0) {
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
        extraMs: mine.extraMs,
        answered: question.answered,
        myChoice: mine.choice,
        removed: mine.removed,
        doubled: mine.doubled,
        powerupThisQuestion: mine.powerupThisQuestion,
        retryArmed: mine.retryArmed,
        retryPrompt: mine.retryPrompt,
        frozenUntil: mine.frozenMs > 0 ? now + mine.frozenMs : 0,
        frozenBy: mine.frozenMs > 0 ? (same?.frozenBy ?? null) : null,
        reveal: null,
        resyncing: false,
      }));
      return;
    }
    const lockedIn = question.answered.includes(g.start.youId);
    const extraMs = same?.extraMs ?? 0;
    if (same && same.myChoice !== null && !lockedIn && question.remainingMs + extraMs > 0) {
      toast({ kind: 'error', title: 'Отговорът ти не стигна до сървъра.', body: 'Избери отново — времето още тече.' });
    }
    patchGame(() => ({
      phase: 'question',
      question,
      deadline: Date.now() + question.remainingMs + extraMs,
      extraMs,
      answered: question.answered,
      myChoice: lockedIn ? (same?.myChoice ?? -1) : null,
      removed: same?.removed ?? [],
      doubled: same?.doubled ?? false,
      powerupThisQuestion: same?.powerupThisQuestion ?? false,
      retryArmed: same?.retryArmed ?? false,
      retryPrompt: !lockedIn && !!same?.retryPrompt,
      frozenUntil: same?.frozenUntil ?? 0,
      frozenBy: same?.frozenBy ?? null,
      reveal: null,
      resyncing: false,
    }));
  });

  s.on('game:answered', ({ playerId }) => patchGame((g) => ({ answered: [...g.answered, playerId] })));

  // The screen showed the pick as locked in; it wasn't taken. Unlock it (if the question is still open) and say why.
  s.on('game:rejected', ({ index, reason }) => {
    const g = getState().game;
    if (!g?.question || g.question.index !== index) return;
    if (g.phase === 'question') patchGame(() => ({ myChoice: null }));
    toast({ kind: 'error', title: REJECTED[reason] });
  });

  s.on('game:retry', ({ wrong }) => {
    effect('wrong');
    patchGame((g) => ({ myChoice: null, retryPrompt: true, removed: [...g.removed, wrong] }));
  });

  s.on('game:reveal', (reveal) => {
    patchGame((g) => {
      const q = g.question;
      const mine = reveal.results[g.start.youId];
      const recorded = !q || q.index !== reveal.index || g.history.some((h) => h.index === reveal.index);
      return {
        phase: 'reveal',
        reveal,
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
                right: !!mine?.correct,
                fact: reveal.fact ?? null,
              },
            ],
      };
    });
    const g = getState().game;
    if (!g) return;
    const mine = reveal.results[g.start.youId];
    if (mine) effect(mine.correct ? 'correct' : 'wrong');
    if (reveal.eliminated.length)
      setTimeout(() => effect(reveal.eliminated.includes(g.start.youId) ? 'knockedOut' : 'eliminated'), 900);
  });

  s.on('game:powerup', ({ playerId, powerup, removed, targetId, extraMs }) => {
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
        deadline: x.deadline + (extraMs ?? 0),
        extraMs: x.extraMs + (extraMs ?? 0),
      }));
    }
    // "Леден удар" takes hold when the next question opens (see game:frozen); now it's only news.
    if (powerup === 'freeze' && targetId) {
      const by = playerId === you ? 'Ти' : nameOf(g, playerId);
      pushFeed(
        targetId === you
          ? `${by} те замрази за следващия въпрос!`
          : `${by} замрази ${nameOf(g, targetId)} за следващия въпрос!`,
        '❄️',
      );
    } else if (playerId !== you) {
      pushFeed(`${nameOf(g, playerId)} използва „${def?.name ?? powerup}“`, def?.icon ?? '🃏');
    }
  });

  s.on('game:frozen', ({ by, ms }) => {
    if (!getState().game) return;
    effect('freeze');
    patchGame(() => ({ frozenUntil: Date.now() + ms + 150, frozenBy: by }));
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

  s.on('server:draining', ({ message }) => setState({ maintenance: message }));
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

type MoveEvent = 'game:answer' | 'game:powerup' | 'game:react';

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
  startSolo: (category: CategoryChoice) => ask(() => withTimeout().emitWithAck('solo:start', { category })),
  startDaily: () => ask(() => withTimeout().emitWithAck('daily:start')),
  /** Plays a challenge link, or (no id) makes a new one and plays it first. */
  startChallenge: (id?: string) => ask<{ id: string }>(() => withTimeout().emitWithAck('challenge:start', { id })),
  requestRematch: (gameId: string) => getSocket().emit('rematch:request', { gameId }),
  /** Leaving the results screen: the others shouldn't wait for a rematch that won't come. */
  declineRematch: (gameId: string) => {
    getSocket().emit('rematch:decline', { gameId });
    setState({ rematch: null });
  },
  createRoom: (settings: Partial<RoomSettings> = {}) =>
    ask<{ code: string }>(() => withTimeout().emitWithAck('room:create', settings)),
  joinRoom: (code: string) => ask<{ code: string }>(() => withTimeout().emitWithAck('room:join', code)),
  leaveRoom: () => {
    getSocket().emit('room:leave');
    setState({ room: null });
  },
  roomSettings: (settings: Partial<RoomSettings>) => getSocket().emit('room:settings', settings),
  roomBot: (action: 'add' | 'remove') => getSocket().emit('room:bot', action),
  roomKick: (playerId: string) => getSocket().emit('room:kick', playerId),
  roomTeam: (playerId: string) => getSocket().emit('room:team', playerId),
  startRoom: () => ask(() => withTimeout().emitWithAck('room:start')),
  invite: (userId: number) => ask(() => withTimeout().emitWithAck('invite:send', { userId })),
  declineInvite: (invite: Invite) => {
    getSocket().emit('invite:decline', { inviteId: invite.id });
    dropInvite(invite.id);
  },
  challenge: (userId: number) =>
    ask<{ code: string }>(() => withTimeout().emitWithAck('friends:challenge', { userId })),
  answer: (choice: number) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.resyncing || g.myChoice !== null || g.removed.includes(choice))
      return;
    if (g.frozenUntil > Date.now()) return;
    if (!sendMove('game:answer', { index: g.question.index, choice })) return offlineToast('Отговорът не е изпратен.');
    effect('lock');
    patchGame(() => ({ myChoice: choice, retryPrompt: false }));
  },
  powerup: (powerup: PowerupId) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.resyncing) return;
    // Only "Леден удар" (it hits the next question) can follow your answer.
    if (g.myChoice !== null && powerup !== 'freeze') return;
    if (g.usedPowerups.includes(powerup) || g.powerupThisQuestion) return;
    if (!sendMove('game:powerup', { index: g.question.index, powerup })) offlineToast('Козът не е изигран.');
  },
  /**
   * Stop on the revealed question's fact to read it (a run played alone): the next question waits for resumeAfterFact.
   * Resolves to whether the server took it (it may have moved on already).
   */
  holdOnFact: async (index: number) => (await ask(() => withTimeout().emitWithAck('game:hold', { index }))).ok,
  resumeAfterFact: () => getSocket().emit('game:resume'),
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
