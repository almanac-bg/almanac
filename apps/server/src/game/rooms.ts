import { randomUUID } from 'node:crypto';
import {
  type AckResult,
  DEFAULT_ROOM_SETTINGS,
  isCategoryChoice,
  ROOM_LIMITS,
  type RoomSettings,
  type RoomState,
  type TeamId,
} from '@quiz/shared';
import { areFriends } from '../friends';
import { friendsChanged, notifyUser, presence } from '../notify';
import { publicUser } from '../users';
import { type Bot, makeBots } from './bots';
import type { Game } from './Game';
import type { IO, IOSocket } from './io';
import { averageOf, buildHuman, type GameRegistry } from './registry';

/** Lobby members who drop (e.g. a page refresh) keep their seat this long. */
const RECONNECT_GRACE_MS = 20_000;
const INVITE_TTL_MS = 60_000;

interface Room {
  code: string;
  hostUserId: number;
  settings: RoomSettings;
  members: number[];
  bots: Bot[];
  /** Team per player id, when the room plays in teams. */
  teams: Map<string, TeamId>;
  game: Game | null;
}

const memberId = (userId: number) => `u${userId}`;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byUser = new Map<number, Room>();
  private graceTimers = new Map<number, NodeJS.Timeout>();

  constructor(
    private io: IO,
    private games: GameRegistry,
    private isOnline: (userId: number) => boolean,
  ) {
    games.onClosed((game) => {
      const room = game.setup.roomCode ? this.rooms.get(game.setup.roomCode) : undefined;
      if (!room || room.game !== game) return;
      room.game = null;
      for (const userId of [...room.members]) if (!this.isOnline(userId)) this.leave(userId);
      if (this.rooms.has(room.code)) this.broadcast(room);
    });
  }

  roomOf(userId: number) {
    return this.byUser.get(userId);
  }

  create(userId: number, patch: Partial<RoomSettings>): AckResult<{ code: string }> {
    this.leave(userId);
    let code: string;
    do code = String(Math.floor(10000 + Math.random() * 90000));
    while (this.rooms.has(code));
    const room: Room = {
      code,
      hostUserId: userId,
      settings: sanitize(patch, DEFAULT_ROOM_SETTINGS, 1),
      members: [],
      bots: [],
      teams: new Map(),
      game: null,
    };
    this.rooms.set(code, room);
    this.add(room, userId);
    return { ok: true, code };
  }

  join(userId: number, code: string): AckResult<{ code: string }> {
    const room = this.rooms.get(code.trim());
    if (!room) return { ok: false, error: 'Няма стая с този код.' };
    if (room.members.includes(userId)) {
      this.broadcast(room);
      return { ok: true, code: room.code };
    }
    if (room.game) return { ok: false, error: 'Играта в тази стая вече е започнала.' };
    if (room.members.length + room.bots.length >= room.settings.maxPlayers) return { ok: false, error: 'Стаята е пълна.' };
    this.leave(userId);
    this.add(room, userId);
    return { ok: true, code: room.code };
  }

  leave(userId: number) {
    this.clearGrace(userId);
    const room = this.byUser.get(userId);
    if (!room) return;
    this.byUser.delete(userId);
    room.members = room.members.filter((id) => id !== userId);
    room.teams.delete(memberId(userId));
    friendsChanged(userId);
    this.io.in(`user:${userId}`).socketsLeave(`room:${room.code}`);
    this.io.to(`user:${userId}`).emit('room:state', null);
    if (room.members.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostUserId === userId) room.hostUserId = room.members[0];
    this.broadcast(room);
  }

  updateSettings(userId: number, patch: Partial<RoomSettings>) {
    const room = this.hostRoom(userId);
    if (!room) return;
    const wasTeams = room.settings.teams;
    room.settings = sanitize(patch, room.settings, room.members.length + room.bots.length);
    if (room.settings.teams && !wasTeams) this.rebalance(room);
    this.broadcast(room);
  }

  /** Host moves a player to the other team. */
  switchTeam(userId: number, playerId: string) {
    const room = this.hostRoom(userId);
    if (!room?.settings.teams || !room.teams.has(playerId)) return;
    room.teams.set(playerId, room.teams.get(playerId) === 0 ? 1 : 0);
    this.broadcast(room);
  }

  /** Invites an online friend into the room you're in. */
  invite(fromId: number, toId: number, kind: 'room' | 'challenge' = 'room'): AckResult {
    const room = this.byUser.get(fromId);
    if (!room || room.game) return { ok: false, error: 'Първо влез в стая.' };
    if (!areFriends(fromId, toId)) return { ok: false, error: 'Можеш да каниш само приятели.' };
    if (presence(toId) === 'offline') return { ok: false, error: 'Приятелят ти не е онлайн.' };
    if (room.members.includes(toId)) return { ok: false, error: 'Вече е в стаята.' };
    const from = publicUser(fromId)!;
    notifyUser(toId, 'invite', { id: randomUUID(), from, roomCode: room.code, kind, expiresAt: Date.now() + INVITE_TTL_MS });
    return { ok: true };
  }

  /** A 1v1 private room with the friend invited straight away. */
  challenge(fromId: number, toId: number): AckResult<{ code: string }> {
    if (!areFriends(fromId, toId)) return { ok: false, error: 'Можеш да предизвикваш само приятели.' };
    if (presence(toId) === 'offline') return { ok: false, error: 'Приятелят ти не е онлайн.' };
    const created = this.create(fromId, { maxPlayers: 2 });
    if (!created.ok) return created;
    const sent = this.invite(fromId, toId, 'challenge');
    return sent.ok ? created : sent;
  }

  bot(userId: number, action: 'add' | 'remove') {
    const room = this.hostRoom(userId);
    if (!room) return;
    if (action === 'add' && room.members.length + room.bots.length < room.settings.maxPlayers) {
      const humans = room.members.map((id) => buildHuman(id, 'custom'));
      const taken = [...humans.map((h) => h.player.name), ...room.bots.map((b) => b.player.name)];
      const [bot] = makeBots(1, averageOf(humans), taken);
      room.bots.push(bot);
      if (room.settings.teams) room.teams.set(bot.player.id, this.smallerTeam(room));
    } else if (action === 'remove') {
      const bot = room.bots.pop();
      if (bot) room.teams.delete(bot.player.id);
    }
    this.broadcast(room);
  }

  kick(userId: number, playerId: string) {
    const room = this.hostRoom(userId);
    if (!room) return;
    const bot = room.bots.findIndex((b) => b.player.id === playerId);
    if (bot !== -1) {
      room.teams.delete(playerId);
      room.bots.splice(bot, 1);
      this.broadcast(room);
      return;
    }
    const target = Number(playerId.replace(/^u/, ''));
    if (target === userId || !room.members.includes(target)) return;
    this.leave(target);
    this.io.to(`user:${target}`).emit('notice', { kind: 'info', message: 'Домакинът те премахна от стаята.' });
  }

  start(userId: number): AckResult {
    const room = this.byUser.get(userId);
    if (!room) return { ok: false, error: 'Не си в стая.' };
    if (room.hostUserId !== userId) return { ok: false, error: 'Само домакинът може да започне играта.' };
    if (room.game) return { ok: false, error: 'Играта вече тече.' };
    if (room.members.length + room.bots.length < 2) return { ok: false, error: 'Трябват поне двама играчи — покани приятел или добави бот.' };
    if (room.members.some((id) => this.games.forUser(id))) return { ok: false, error: 'Някой от играчите още е в друга игра.' };
    const teams = room.settings.teams;
    if (teams && new Set(room.teams.values()).size < 2) return { ok: false, error: 'И двата отбора трябва да имат поне по един играч.' };
    const teamOf = (playerId: string) => (teams ? (room.teams.get(playerId) ?? 0) : null);
    try {
      room.game = this.games.start({
        mode: 'custom',
        ranked: false,
        roomCode: room.code,
        hostUserId: room.hostUserId,
        questionCount: room.settings.questions,
        timeMs: room.settings.timeMs,
        category: room.settings.category,
        elimination: room.settings.elimination && !teams,
        teams,
        humans: room.members.map((id) => {
          const h = buildHuman(id, 'custom');
          h.player.team = teamOf(h.player.id);
          return h;
        }),
        bots: room.bots.map((b) => ({ ...b, player: { ...b.player, team: teamOf(b.player.id) } })),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Играта не можа да започне.' };
    }
    this.broadcast(room);
    return { ok: true };
  }

  connected(userId: number, socket: IOSocket) {
    this.clearGrace(userId);
    const room = this.byUser.get(userId);
    if (!room) return;
    socket.join(`room:${room.code}`);
    socket.emit('room:state', this.state(room));
  }

  disconnected(userId: number) {
    const room = this.byUser.get(userId);
    if (!room || room.game) return;
    this.clearGrace(userId);
    this.graceTimers.set(
      userId,
      setTimeout(() => this.leave(userId), RECONNECT_GRACE_MS),
    );
  }

  private add(room: Room, userId: number) {
    room.members.push(userId);
    if (room.settings.teams) room.teams.set(memberId(userId), this.smallerTeam(room));
    this.byUser.set(userId, room);
    friendsChanged(userId);
    this.io.in(`user:${userId}`).socketsJoin(`room:${room.code}`);
    this.broadcast(room);
  }

  private smallerTeam(room: Room): TeamId {
    const counts = [0, 0];
    for (const t of room.teams.values()) counts[t]++;
    return counts[0] <= counts[1] ? 0 : 1;
  }

  /** Alternates everyone between the two teams in join order. */
  private rebalance(room: Room) {
    room.teams.clear();
    const ids = [...room.members.map(memberId), ...room.bots.map((b) => b.player.id)];
    ids.forEach((id, i) => room.teams.set(id, (i % 2) as TeamId));
  }

  private hostRoom(userId: number) {
    const room = this.byUser.get(userId);
    return room && room.hostUserId === userId && !room.game ? room : undefined;
  }

  private clearGrace(userId: number) {
    const t = this.graceTimers.get(userId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(userId);
  }

  private broadcast(room: Room) {
    this.io.to(`room:${room.code}`).emit('room:state', this.state(room));
  }

  private state(room: Room): RoomState {
    return {
      code: room.code,
      hostId: `u${room.hostUserId}`,
      settings: room.settings,
      inGame: room.game !== null,
      players: [
        ...room.members.map((id) => ({ ...buildHuman(id, 'custom').player, isHost: id === room.hostUserId })),
        ...room.bots.map((b) => ({ ...b.player, isHost: false })),
      ].map((p) => ({ ...p, team: room.settings.teams ? (room.teams.get(p.id) ?? 0) : null })),
    };
  }
}

function sanitize(patch: Partial<RoomSettings>, current: RoomSettings, occupied: number): RoomSettings {
  const next = { ...current };
  const [minPlayers, maxPlayers] = ROOM_LIMITS.maxPlayers;
  if (Number.isInteger(patch.maxPlayers)) {
    next.maxPlayers = Math.min(maxPlayers, Math.max(minPlayers, occupied, patch.maxPlayers!));
  }
  if ((ROOM_LIMITS.questions as readonly number[]).includes(patch.questions as number)) next.questions = patch.questions!;
  if ((ROOM_LIMITS.timeMs as readonly number[]).includes(patch.timeMs as number)) next.timeMs = patch.timeMs!;
  if (isCategoryChoice(patch.category)) next.category = patch.category;
  if (typeof patch.elimination === 'boolean') next.elimination = patch.elimination;
  if (typeof patch.teams === 'boolean') next.teams = patch.teams;
  if (next.teams) next.elimination = false;
  return next;
}
