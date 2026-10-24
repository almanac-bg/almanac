import {
  type AckResult,
  achievementById,
  type CategoryChoice,
  type ClientToServerEvents,
  FREEZE_MS,
  type Invite,
  powerupById,
  type PowerupId,
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
const nameOf = (g: LiveGame, playerId: string) => g.players[playerId]?.name ?? 'Някой';

/** The realtime connection, created on first use from the client config. */
export function getSocket(): GameSocket {
  if (!socket) {
    socket = io(clientConfig().baseUrl || undefined, { autoConnect: false });
    bind(socket);
  }
  return socket;
}

export const connectRealtime = () => getSocket().connect();
export const disconnectRealtime = () => socket?.disconnect();

/** After a reconnect the server re-sends live state right away; anything it doesn't re-send is gone. */
let resyncTimer: ReturnType<typeof setTimeout> | undefined;

function bind(s: GameSocket) {
  s.on('connect', () => {
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
  s.on('disconnect', () => setState({ connected: false }));
  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') setState({ me: null });
  });

  s.on('lobby:stats', (lobby) => setState({ lobby }));

  s.on('queue:status', (queue) =>
    setState((st) => ({ queue, queueSince: queue && !st.queue ? Date.now() - queue.waitedMs : st.queueSince })),
  );

  s.on('room:state', (room) => setState({ room }));

  s.on('game:start', (start) => {
    clearTimeout(resyncTimer);
    const now = Date.now();
    setState({
      queue: null,
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
        eliminated: start.standings.filter((x) => x.eliminatedAt !== null).map((x) => x.id),
        reactions: [],
        feed: [],
        history: [],
        end: null,
      },
    });
  });

  s.on('game:question', (question) =>
    patchGame((g) => ({
      phase: 'question',
      question,
      deadline: Date.now() + question.remainingMs,
      extraMs: 0,
      answered: question.answered,
      myChoice: question.answered.includes(g.start.youId) ? -1 : null,
      removed: [],
      doubled: false,
      powerupThisQuestion: false,
      retryArmed: false,
      retryPrompt: false,
      frozenUntil: 0,
      frozenBy: null,
      reveal: null,
    })),
  );

  s.on('game:answered', ({ playerId }) => patchGame((g) => ({ answered: [...g.answered, playerId] })));

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
              },
            ],
      };
    });
    const g = getState().game;
    if (!g) return;
    const mine = reveal.results[g.start.youId];
    if (mine) effect(mine.correct ? 'correct' : 'wrong');
    if (reveal.eliminated.length) setTimeout(() => effect('eliminated'), 900);
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
    if (targetId === you) {
      effect('freeze');
      patchGame(() => ({ frozenUntil: Date.now() + FREEZE_MS + 150, frozenBy: playerId }));
    }
    if (powerup === 'freeze' && targetId) {
      const by = playerId === you ? 'Ти' : nameOf(g, playerId);
      const target = targetId === you ? 'теб' : nameOf(g, targetId);
      pushFeed(`${by} замрази ${target}!`, '❄️');
    } else if (playerId !== you) {
      pushFeed(`${nameOf(g, playerId)} използва „${def?.name ?? powerup}“`, def?.icon ?? '🃏');
    }
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

  s.on('notice', ({ kind, message }) => toast({ kind, title: message }));

  s.on('server:draining', ({ message }) => setState({ maintenance: message }));
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

export const actions = {
  joinQueue: (mode: QueueModeId) => ask(() => withTimeout().emitWithAck('queue:join', mode)),
  leaveQueue: () => {
    getSocket().emit('queue:leave');
    setState({ queue: null });
  },
  startSolo: (category: CategoryChoice) => ask(() => withTimeout().emitWithAck('solo:start', { category })),
  startDaily: () => ask(() => withTimeout().emitWithAck('daily:start')),
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
    getSocket().emit('invite:decline', { fromUserId: invite.from.id });
    dropInvite(invite.id);
  },
  challenge: (userId: number) => ask<{ code: string }>(() => withTimeout().emitWithAck('friends:challenge', { userId })),
  answer: (choice: number) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.myChoice !== null || g.removed.includes(choice)) return;
    if (g.frozenUntil > Date.now()) return;
    effect('lock');
    patchGame(() => ({ myChoice: choice, retryPrompt: false }));
    getSocket().emit('game:answer', { index: g.question.index, choice });
  },
  powerup: (powerup: PowerupId) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.myChoice !== null) return;
    if (g.usedPowerups.includes(powerup) || g.powerupThisQuestion) return;
    getSocket().emit('game:powerup', { index: g.question.index, powerup });
  },
  react: (emote: string) => getSocket().emit('game:react', emote),
  leaveGame: () => {
    getSocket().emit('game:leave');
    setState({ game: null });
  },
  /** Drop a finished game's state (results screen dismissed). */
  closeGame: () => setState({ game: null }),
};
