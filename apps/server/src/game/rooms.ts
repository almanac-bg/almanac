import { randomInt, randomUUID } from 'node:crypto';
import {
  type AckResult,
  DEFAULT_ROOM_SETTINGS,
  isCategoryChoice,
  ROOM_CODE_DIGITS,
  ROOM_LIMITS,
  ROUNDS_QUESTIONS,
  type RoomSettings,
  type RoomState,
  type TeamId,
} from '@quiz/shared';
import { areFriends } from '../friends';
import { guarded } from '../guard';
import { friendsChanged, notifyUser, presence } from '../notify';
import { getRating } from '../seasons';
import { prepareSet, setForRoom } from '../sets';
import { getUser, publicUser } from '../users';
import { type Bot, makeBots } from './bots';
import type { Game } from './Game';
import type { IO, IOSocket } from './io';
import { averageOf, buildHuman, type GameRegistry, startFailure } from './registry';

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
  /** Players the host removed; they can't rejoin unless invited again. */
  kicked: Set<number>;
  /** What guests go by here (they pick it when they join): an account plays under its own name. */
  nicknames: Map<number, string>;
}

interface PendingInvite {
  from: number;
  to: number;
  expiresAt: number;
}

const memberId = (userId: number) => `u${userId}`;

export class RoomManager {
  private rooms = new Map<string, Room>();

  /** Who a room's link comes from (its host), for the link's preview in a chat app; null if there's no such room. */
  preview(code: string): { host: string; players: number } | null {
    const room = this.rooms.get(code);
    const host = room && getUser(room.hostUserId);
    return host ? { host: host.username, players: room.members.length + room.bots.length } : null;
  }
  private byUser = new Map<number, Room>();
  private graceTimers = new Map<number, NodeJS.Timeout>();
  /** Invites sent and not yet expired, so a "decline" can only answer a real one. */
  private invites = new Map<string, PendingInvite>();

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

  create(userId: number, patch: Record<string, unknown>): AckResult<{ code: string }> {
    this.leave(userId);
    let code: string;
    do code = String(randomInt(10 ** (ROOM_CODE_DIGITS - 1), 10 ** ROOM_CODE_DIGITS));
    while (this.rooms.has(code));
    const room: Room = {
      code,
      hostUserId: userId,
      settings: sanitize(patch, DEFAULT_ROOM_SETTINGS, 1),
      members: [],
      bots: [],
      teams: new Map(),
      game: null,
      kicked: new Set(),
      nicknames: new Map(),
    };
    this.rooms.set(code, room);
    this.add(room, userId);
    return { ok: true, code };
  }

  /** `nickname`: what a guest goes by here — a guest has no name of their own to show, so they have to give one. */
  join(userId: number, code: string, nickname: unknown = null): AckResult<{ code: string }> {
    const room = this.rooms.get(code.trim());
    if (!room) return { ok: false, error: 'Няма стая с този код.' };
    if (room.members.includes(userId)) {
      this.broadcast(room);
      return { ok: true, code: room.code };
    }
    if (room.kicked.has(userId)) return { ok: false, error: 'Домакинът те премахна от тази стая.' };
    if (room.game) return { ok: false, error: 'Играта в тази стая вече е започнала.' };
    if (room.members.length + room.bots.length >= room.settings.maxPlayers)
      return { ok: false, error: 'Стаята е пълна.' };
    let name: string | null = null;
    if (getUser(userId)?.is_guest) {
      name = cleanNickname(nickname);
      if (!name) return { ok: false, error: NICKNAME_ERROR };
      const taken = new Set(this.state(room).players.map((p) => p.name.toLocaleLowerCase('bg')));
      if (taken.has(name.toLocaleLowerCase('bg'))) return { ok: false, error: 'Някой в стаята вече е с това име.' };
    }
    this.leave(userId);
    if (name) room.nicknames.set(userId, name);
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
    room.nicknames.delete(userId);
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

  updateSettings(userId: number, patch: Record<string, unknown>) {
    const room = this.hostRoom(userId);
    if (!room) return;
    const wasTeams = room.settings.teams;
    room.settings = sanitize(patch, room.settings, room.members.length + room.bots.length);
    // The host's own set (theirs, not hidden, with questions in it), or back to the bank (null).
    if (patch.set === null) room.settings.set = null;
    else if (typeof patch.set === 'number') {
      const set = setForRoom(patch.set, userId);
      if (set && set !== 'empty') room.settings.set = set;
    }
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
  invite(fromId: number, toId: number): AckResult {
    const room = this.byUser.get(fromId);
    if (!room || room.game) return { ok: false, error: 'Първо влез в стая.' };
    if (!areFriends(fromId, toId)) return { ok: false, error: 'Можеш да каниш само приятели.' };
    if (presence(toId) === 'offline') return { ok: false, error: 'Приятелят ти не е онлайн.' };
    if (room.members.includes(toId)) return { ok: false, error: 'Вече е в стаята.' };
    const from = publicUser(fromId)!;
    const now = Date.now();
    for (const [id, invite] of this.invites) if (invite.expiresAt < now) this.invites.delete(id);
    const id = randomUUID();
    this.invites.set(id, { from: fromId, to: toId, expiresAt: now + INVITE_TTL_MS });
    room.kicked.delete(toId); // inviting someone back lifts a kick
    notifyUser(toId, 'invite', { id, from, roomCode: room.code, kind: 'room', expiresAt: now + INVITE_TTL_MS });
    return { ok: true };
  }

  /** The invited player says no: returns who invited them, or null if there's no such invite for them. */
  declineInvite(userId: number, inviteId: string): number | null {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.to !== userId || invite.expiresAt < Date.now()) return null;
    this.invites.delete(inviteId);
    return invite.from;
  }

  bot(userId: number, action: 'add' | 'remove') {
    const room = this.hostRoom(userId);
    if (!room) return;
    if (action === 'add' && room.members.length + room.bots.length < room.settings.maxPlayers) {
      const humans = room.members.map((id) => this.human(room, id));
      const taken = [...humans.map((h) => h.player.name), ...room.bots.map((b) => b.player.name)];
      // Room games are unrated; bots play at about the room's players' level (until it's measured, their duel rating).
      const [bot] = makeBots(
        1,
        averageOf(humans, (h) => getRating(h.player.userId!, 'duel')),
        taken,
      );
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
    room.kicked.add(target);
    this.leave(target);
    this.io.to(`user:${target}`).emit('notice', { kind: 'info', message: 'Домакинът те премахна от стаята.' });
  }

  start(userId: number): AckResult {
    const room = this.byUser.get(userId);
    if (!room) return { ok: false, error: 'Не си в стая.' };
    if (room.hostUserId !== userId) return { ok: false, error: 'Само домакинът може да започне играта.' };
    if (room.game) return { ok: false, error: 'Играта вече тече.' };
    // Someone whose connection just dropped is still listed for a few seconds, but only players who are here play —
    // and the host only if they play along (else they run it on a big screen).
    const hosting = !room.settings.hostPlays;
    const players = room.members.filter((id) => this.isOnline(id) && !(hosting && id === room.hostUserId));
    if (hosting && players.length === 0) return { ok: false, error: 'Още няма кой да играе — прати кода на играчите.' };
    // Playing along, the host needs someone to play with; running it for others, one of them is enough.
    if (!hosting && players.length + room.bots.length < 2)
      return { ok: false, error: 'Трябват поне двама играчи — покани приятел или добави бот.' };
    if (players.some((id) => this.games.forUser(id)))
      return { ok: false, error: 'Някой от играчите още е в друг мач.' };
    const teams = room.settings.teams;
    const teamOf = (playerId: string) => (teams ? (room.teams.get(playerId) ?? 0) : null);
    const seated = [...players.map((id) => `u${id}`), ...room.bots.map((b) => b.player.id)];
    if (teams && new Set(seated.map(teamOf)).size < 2)
      return { ok: false, error: 'И двата отбора трябва да имат поне по един играч.' };
    // The host's own set, as they saved it last.
    const own = room.settings.set;
    const questions = own ? prepareSet(own.id, room.hostUserId) : null;
    if (own && !questions?.length) {
      room.settings.set = null;
      this.broadcast(room);
      return { ok: false, error: 'Наборът вече не може да се играе — избери друг или въпроси от АЛМАНАХ.' };
    }
    try {
      room.game = this.games.start({
        mode: 'custom',
        ranked: false,
        roomCode: room.code,
        hostUserId: room.hostUserId,
        questionCount: questions?.length ?? room.settings.questions,
        timeMs: room.settings.timeMs,
        category: own ? 'mixed' : room.settings.category,
        inRounds: !own && room.settings.rounds,
        final: room.settings.final,
        pictures: !own && room.settings.pictures,
        ...(own && questions && { questions, questionSet: own.name }),
        presenter: hosting ? room.hostUserId : null,
        elimination: room.settings.elimination && !teams,
        teams,
        humans: players.map((id) => {
          const h = this.human(room, id);
          h.player.team = teamOf(h.player.id);
          return h;
        }),
        bots: room.bots.map((b) => ({ ...b, player: { ...b.player, team: teamOf(b.player.id) } })),
      });
    } catch (err) {
      return { ok: false, error: startFailure(err) };
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
      setTimeout(
        guarded('room grace', () => this.leave(userId)),
        RECONNECT_GRACE_MS,
      ),
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
    for (const [i, id] of ids.entries()) room.teams.set(id, (i % 2) as TeamId);
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

  /** A member as they play here: under the name a guest picked for the room. */
  private human(room: Room, userId: number) {
    const h = buildHuman(userId, 'custom');
    const nickname = room.nicknames.get(userId);
    if (nickname) h.player.name = nickname;
    return h;
  }

  private state(room: Room): RoomState {
    return {
      code: room.code,
      hostId: `u${room.hostUserId}`,
      settings: room.settings,
      inGame: room.game !== null,
      players: [
        ...room.members.map((id) => ({ ...this.human(room, id).player, isHost: id === room.hostUserId })),
        ...room.bots.map((b) => ({ ...b.player, isHost: false })),
      ].map((p) => ({ ...p, team: room.settings.teams ? (room.teams.get(p.id) ?? 0) : null })),
    };
  }
}

/** The settings a host sent (straight from the socket, so anything at all), applied where they make sense. */
function sanitize(patch: Record<string, unknown>, current: RoomSettings, occupied: number): RoomSettings {
  const next = { ...current };
  const [minPlayers, maxPlayers] = ROOM_LIMITS.maxPlayers;
  const { maxPlayers: players, questions, timeMs } = patch;
  for (const key of ['rounds', 'final', 'pictures', 'elimination', 'teams', 'hostPlays'] as const) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  if (typeof players === 'number' && Number.isInteger(players)) {
    next.maxPlayers = Math.min(maxPlayers, Math.max(minPlayers, occupied, players));
  }
  if (typeof questions === 'number' && (ROOM_LIMITS.questions as readonly number[]).includes(questions))
    next.questions = questions;
  if (typeof timeMs === 'number' && (ROOM_LIMITS.timeMs as readonly number[]).includes(timeMs)) next.timeMs = timeMs;
  if (isCategoryChoice(patch.category)) next.category = patch.category;
  // Picking rounds is with the mix of categories, ten questions long (ROUNDS_QUESTIONS); a round's questions are its
  // category's, not pictures.
  if (next.category !== 'mixed') next.rounds = false;
  if (patch.pictures === true) next.rounds = false;
  else if (patch.rounds === true) next.pictures = false;
  if (next.rounds) next.questions = ROUNDS_QUESTIONS;
  if (next.teams) next.elimination = false;
  // Knockouts one at a time are for a handful of players: with them on the room takes at most that many, and with more
  // already in it they stay off.
  if (next.elimination) {
    if (occupied > ROOM_LIMITS.eliminationPlayers) next.elimination = false;
    else next.maxPlayers = Math.min(next.maxPlayers, ROOM_LIMITS.eliminationPlayers);
  }
  return next;
}

/** A guest's name for a room: letters, digits, spaces and . - _ (2–20); null if it isn't one. */
export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...name].length;
  return length >= 2 && length <= 20 && /^[\p{L}\p{N} ._-]+$/u.test(name) ? name : null;
}

const NICKNAME_ERROR = 'Избери име за стаята: от 2 до 20 букви, цифри или интервали.';
