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
import { sfx } from './sound';
import { getState, type LiveGame, patchGame, setState, toast } from './store';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });

let seq = 0;
const nameOf = (g: LiveGame, playerId: string) => g.players[playerId]?.name ?? 'Някой';

/** After a reconnect the server re-sends live state right away; anything it doesn't re-send is gone. */
let resyncTimer: ReturnType<typeof setTimeout> | undefined;
socket.on('connect', () => {
  const { game } = getState();
  setState({ connected: true, queue: null, room: null });
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
socket.on('disconnect', () => setState({ connected: false }));
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') setState({ me: null });
});

socket.on('lobby:stats', (lobby) => setState({ lobby }));

socket.on('queue:status', (queue) =>
  setState((s) => ({ queue, queueSince: queue && !s.queue ? Date.now() - queue.waitedMs : s.queueSince })),
);

socket.on('room:state', (room) => setState({ room }));

socket.on('game:start', (start) => {
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
      eliminated: start.standings.filter((s) => s.eliminatedAt !== null).map((s) => s.id),
      reactions: [],
      feed: [],
      end: null,
    },
  });
});

socket.on('game:question', (question) =>
  patchGame((g) => ({
    phase: 'question',
    question,
    deadline: Date.now() + question.remainingMs,
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

socket.on('game:answered', ({ playerId }) => patchGame((g) => ({ answered: [...g.answered, playerId] })));

socket.on('game:retry', ({ wrong }) => {
  sfx.wrong();
  patchGame((g) => ({ myChoice: null, retryPrompt: true, removed: [...g.removed, wrong] }));
});

socket.on('game:reveal', (reveal) => {
  patchGame((g) => ({
    phase: 'reveal',
    reveal,
    retryPrompt: false,
    standings: reveal.standings,
    eliminated: [...g.eliminated, ...reveal.eliminated],
  }));
  const g = getState().game;
  if (!g) return;
  const mine = reveal.results[g.start.youId];
  if (mine) (mine.correct ? sfx.correct : sfx.wrong)();
  if (reveal.eliminated.length) setTimeout(sfx.eliminated, 900);
});

function pushFeed(text: string, icon: string) {
  const key = ++seq;
  patchGame((x) => ({ feed: [...x.feed, { key, text, icon }] }));
  setTimeout(() => patchGame((x) => ({ feed: x.feed.filter((f) => f.key !== key) })), 3200);
}

socket.on('game:powerup', ({ playerId, powerup, removed, targetId, extraMs }) => {
  const g = getState().game;
  if (!g) return;
  const def = powerupById(powerup);
  const you = g.start.youId;

  if (playerId === you) {
    sfx.powerup();
    patchGame((x) => ({
      usedPowerups: [...x.usedPowerups, powerup],
      powerupThisQuestion: true,
      removed: removed ?? x.removed,
      doubled: x.doubled || powerup === 'double',
      retryArmed: x.retryArmed || powerup === 'retry',
      deadline: x.deadline + (extraMs ?? 0),
    }));
  }
  if (targetId === you) {
    sfx.freeze();
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

socket.on('game:reaction', ({ playerId, emote }) => {
  const key = ++seq;
  patchGame((g) => ({ reactions: [...g.reactions, { key, playerId, emote }] }));
  setTimeout(() => patchGame((g) => ({ reactions: g.reactions.filter((r) => r.key !== key) })), 2600);
});

socket.on('game:presence', ({ playerId, connected, left }) =>
  patchGame((g) => ({ standings: g.standings.map((s) => (s.id === playerId ? { ...s, connected, left } : s)) })),
);

socket.on('game:end', (end) => {
  const g = getState().game;
  if (!g || g.start.gameId !== end.gameId) return;
  patchGame(() => ({ phase: 'ended', end, standings: end.standings }));
  void refreshMe();
});

socket.on('friends:update', () => {
  setState((s) => ({ friendsVersion: s.friendsVersion + 1 }));
  void refreshMe();
});

socket.on('invite', (invite) => {
  sfx.achievement();
  setState((s) => ({ invites: [...s.invites.filter((i) => i.from.id !== invite.from.id), invite] }));
  setTimeout(() => dropInvite(invite.id), Math.max(0, invite.expiresAt - Date.now()));
});

socket.on('achievements', (ids) => {
  sfx.achievement();
  for (const id of ids) {
    const a = achievementById(id);
    if (a) toast({ kind: 'success', icon: a.icon, title: `Ново постижение: ${a.name}`, body: `+${a.xp} XP` }, 6000);
  }
  void refreshMe();
});

socket.on('notice', ({ kind, message }) => toast({ kind, title: message }));

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

const withTimeout = () => socket.timeout(8000);

export const actions = {
  joinQueue: (mode: QueueModeId) => ask(() => withTimeout().emitWithAck('queue:join', mode)),
  leaveQueue: () => {
    socket.emit('queue:leave');
    setState({ queue: null });
  },
  startSolo: (category: CategoryChoice) => ask(() => withTimeout().emitWithAck('solo:start', { category })),
  startDaily: () => ask(() => withTimeout().emitWithAck('daily:start')),
  createRoom: (settings: Partial<RoomSettings> = {}) =>
    ask<{ code: string }>(() => withTimeout().emitWithAck('room:create', settings)),
  joinRoom: (code: string) => ask<{ code: string }>(() => withTimeout().emitWithAck('room:join', code)),
  leaveRoom: () => {
    socket.emit('room:leave');
    setState({ room: null });
  },
  roomSettings: (settings: Partial<RoomSettings>) => socket.emit('room:settings', settings),
  roomBot: (action: 'add' | 'remove') => socket.emit('room:bot', action),
  roomKick: (playerId: string) => socket.emit('room:kick', playerId),
  roomTeam: (playerId: string) => socket.emit('room:team', playerId),
  startRoom: () => ask(() => withTimeout().emitWithAck('room:start')),
  invite: (userId: number) => ask(() => withTimeout().emitWithAck('invite:send', { userId })),
  declineInvite: (invite: Invite) => {
    socket.emit('invite:decline', { fromUserId: invite.from.id });
    dropInvite(invite.id);
  },
  challenge: (userId: number) => ask<{ code: string }>(() => withTimeout().emitWithAck('friends:challenge', { userId })),
  answer: (choice: number) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.myChoice !== null || g.removed.includes(choice)) return;
    if (g.frozenUntil > Date.now()) return;
    sfx.lock();
    patchGame(() => ({ myChoice: choice, retryPrompt: false }));
    socket.emit('game:answer', { index: g.question.index, choice });
  },
  powerup: (powerup: PowerupId) => {
    const g = getState().game;
    if (!g?.question || g.phase !== 'question' || g.myChoice !== null) return;
    if (g.usedPowerups.includes(powerup) || g.powerupThisQuestion) return;
    socket.emit('game:powerup', { index: g.question.index, powerup });
  },
  react: (emote: string) => socket.emit('game:react', emote),
  leaveGame: () => {
    socket.emit('game:leave');
    setState({ game: null });
  },
  /** Drop a finished game's state (results screen dismissed). */
  closeGame: () => setState({ game: null }),
};
