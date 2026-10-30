import { randomInt, randomUUID } from 'node:crypto';
import {
  type AckResult,
  DEFAULT_ROOM_SETTINGS,
  isCategoryChoice,
  nicknameProblem,
  ROOM_CODE_DIGITS,
  ROOM_LIMITS,
  ROOM_NICKNAME,
  ROUNDS_QUESTIONS,
  type RoomSettings,
  type RoomState,
  type TeamId,
  tidyNickname,
} from '@quiz/shared';
import { areFriends, blockedBetween } from '../friends';
import { guarded } from '../guard';
import { textProblem } from '../names';
import { friendsChanged, notifyUser, presence } from '../notify';
import { getRating } from '../seasons';
import { prepareSet, setForRoom } from '../sets';
import { getUser, keepForTheRoom, nameTaken, publicUser } from '../users';
import { type Bot, makeBots } from './bots';
import type { Game } from './Game';
import type { IO, IOSocket } from './io';
import { averageOf, buildHuman, type GameRegistry, startFailure } from './registry';

/** Lobby members who drop (e.g. a page refresh) keep their seat this long; someone at a locked room's door their place. */
const RECONNECT_GRACE_MS = 20_000;
/** …and after a restart (the server down for a few seconds, every page reconnecting), this long. */
const RESTART_GRACE_MS = 60_000;
const INVITE_TTL_MS = 60_000;
/** At a locked room's door at once, at most: a whole class can come late, a stream of new guests can't pile up. */
const MAX_KNOCKS = 40;

interface Room {
  code: string;
  hostUserId: number;
  settings: RoomSettings;
  members: number[];
  bots: Bot[];
  /** Team per player id, when the room plays in teams. */
  teams: Map<string, TeamId>;
  game: Game | null;
  /** Players the host removed, or didn't let in: they can't come back unless invited again. */
  kicked: Set<number>;
  /** What guests go by here (they pick it when they join): an account plays under its own name. */
  nicknames: Map<number, string>;
  /**
   * „Заключи стаята“: nobody new comes in by the code or the link; they knock (`knocks`) and the host lets each in or
   * not. Everyone who has been in the room (`admitted`) may come back, and a friend the host invites walks in.
   */
  locked: boolean;
  /** At the door of the locked room, in the order they came: the name a guest gave (null: an account's own). */
  knocks: Map<number, string | null>;
  admitted: Set<number>;
}

interface PendingInvite {
  from: number;
  to: number;
  expiresAt: number;
}

const memberId = (userId: number) => `u${userId}`;

/** A room's lobby as one server process hands it to the next on a restart (kept(), restore()): plain data. */
export interface KeptRoom {
  code: string;
  hostUserId: number;
  settings: RoomSettings;
  members: number[];
  bots: Bot[];
  teams: [string, TeamId][];
  kicked: number[];
  nicknames: [number, string][];
  locked: boolean;
  knocks: [number, string | null][];
  admitted: number[];
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byUser = new Map<number, Room>();
  /** The room each knocking player waits at (one at a time). */
  private knockingAt = new Map<number, string>();
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
      settings: forAClass(sanitize(patch, DEFAULT_ROOM_SETTINGS, 1), patch, DEFAULT_ROOM_SETTINGS.hostPlays),
      members: [],
      bots: [],
      teams: new Map(),
      game: null,
      kicked: new Set(),
      nicknames: new Map(),
      locked: false,
      knocks: new Map(),
      admitted: new Set(),
    };
    this.rooms.set(code, room);
    this.add(room, userId);
    return { ok: true, code };
  }

  /**
   * `nickname`: what a guest goes by here — a guest has no name of their own to show, so they have to give one. A
   * locked room's door: `waiting` until the host lets them in (they get the room's state) or not (`room:refused`).
   */
  join(userId: number, code: string, nickname: unknown = null): AckResult<{ code: string; waiting?: boolean }> {
    const room = this.rooms.get(code.trim());
    if (!room) return { ok: false, error: 'Няма стая с този код.' };
    if (room.members.includes(userId)) {
      this.broadcast(room);
      return { ok: true, code: room.code };
    }
    if (room.kicked.has(userId)) return { ok: false, error: 'Домакинът те премахна от тази стая.' };
    // Either way round, and without saying who blocked whom.
    if (blockedBetween(room.hostUserId, userId)) return { ok: false, error: 'Не можеш да влезеш в тази стая.' };
    if (room.game) return { ok: false, error: 'Мачът в тази стая вече е започнал.' };
    if (room.members.length + room.bots.length >= room.settings.maxPlayers)
      return { ok: false, error: 'Стаята е пълна.' };
    let name: string | null = null;
    if (getUser(userId)?.is_guest) {
      name = cleanNickname(nickname);
      // The form's own words (it checks the same rule first); a client that sent no name at all, the general ones.
      if (!name)
        return { ok: false, error: (typeof nickname === 'string' && nicknameProblem(nickname)) || NICKNAME_ERROR };
      // On the room's screen (a class's projector too): no words nobody should read, nothing that passes for the
      // game, and no player's own name — a guest could appear as anyone.
      const problem = textProblem(name, 'Името');
      if (problem) return { ok: false, error: problem };
      if (nameTaken(name)) return { ok: false, error: 'Това е името на друг играч — избери друго.' };
      const taken = new Set(this.state(room).players.map((p) => p.name.toLocaleLowerCase('bg')));
      if (taken.has(name.toLocaleLowerCase('bg'))) return { ok: false, error: 'Някой в стаята вече е с това име.' };
      // Their page says so from now on.
      if (keepForTheRoom(userId)) this.io.to(`user:${userId}`).emit('account:update');
    }
    if (room.locked && !room.admitted.has(userId)) {
      if (room.knocks.size >= MAX_KNOCKS && !room.knocks.has(userId))
        return { ok: false, error: 'Стаята е заключена — помоли домакина да я отключи.' };
      this.leave(userId);
      room.knocks.set(userId, name);
      this.knockingAt.set(userId, room.code);
      this.broadcast(room);
      return { ok: true, code: room.code, waiting: true };
    }
    this.leave(userId);
    if (name) room.nicknames.set(userId, name);
    this.add(room, userId);
    return { ok: true, code: room.code };
  }

  leave(userId: number) {
    this.clearGrace(userId);
    this.stopKnocking(userId);
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
      for (const id of [...room.knocks.keys()]) this.turnAway(room, id, 'Стаята се затвори.');
      return;
    }
    if (room.hostUserId === userId) room.hostUserId = room.members[0];
    this.broadcast(room);
  }

  /** „Заключи стаята“, or open it again: whoever is at the door then comes in, as far as there are seats. */
  lock(userId: number, locked: boolean) {
    const room = this.hostRoom(userId);
    if (!room) return;
    room.locked = locked;
    if (!locked) {
      for (const id of [...room.knocks.keys()]) {
        if (this.admit(userId, memberId(id), true).ok) continue;
        const full = room.members.length + room.bots.length >= room.settings.maxPlayers;
        this.turnAway(room, id, full ? 'Стаята е пълна.' : 'Не успя да влезеш — опитай пак.');
      }
    }
    this.broadcast(room);
  }

  /** The host lets someone at the locked room's door in, or doesn't (then they can't knock again). */
  admit(userId: number, playerId: string, admit: boolean): AckResult {
    const room = this.hostRoom(userId);
    if (!room) return { ok: false, error: 'Само домакинът пуска в стаята, между игрите.' };
    const target = Number(playerId.replace(/^u/, ''));
    if (!room.knocks.has(target)) return { ok: false, error: 'Вече не чака на вратата.' };
    if (!admit) {
      room.kicked.add(target);
      this.turnAway(room, target, 'Домакинът не те пусна в стаята.');
      this.broadcast(room);
      return { ok: true };
    }
    if (room.members.length + room.bots.length >= room.settings.maxPlayers)
      return { ok: false, error: 'Стаята е пълна — добави места в настройките.' };
    if (this.games.forUser(target)) return { ok: false, error: 'В момента играе друг мач.' };
    const nickname = room.knocks.get(target);
    room.knocks.delete(target);
    this.knockingAt.delete(target);
    // Someone took the same name while they waited: a number tells the two apart.
    if (nickname) room.nicknames.set(target, this.freeName(room, nickname));
    this.add(room, target);
    return { ok: true };
  }

  /** The host gives a guest's seat a plain „Играч N“ instead of the name the guest typed (on a class's screen above all). */
  rename(userId: number, playerId: string) {
    const room = this.hostRoom(userId);
    const target = Number(playerId.replace(/^u/, ''));
    if (!room?.nicknames.has(target)) return;
    const name = this.freeName(room, 'Играч', 1);
    room.nicknames.set(target, name);
    this.io
      .to(`user:${target}`)
      .emit('notice', { kind: 'info', message: `Домакинът смени името ти в стаята на „${name}“.` });
    this.broadcast(room);
  }

  updateSettings(userId: number, patch: Record<string, unknown>) {
    const room = this.hostRoom(userId);
    if (!room) return;
    const wasTeams = room.settings.teams;
    const wasPlaying = room.settings.hostPlays;
    room.settings = forAClass(
      sanitize(patch, room.settings, room.members.length + room.bots.length),
      patch,
      wasPlaying,
    );
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
    // Inviting someone back lifts a kick, and opens a locked room to them.
    room.kicked.delete(toId);
    room.admitted.add(toId);
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
    room.admitted.delete(target);
    this.leave(target);
    this.io.to(`user:${target}`).emit('notice', { kind: 'info', message: 'Домакинът те премахна от стаята.' });
  }

  start(userId: number): AckResult {
    const room = this.byUser.get(userId);
    if (!room) return { ok: false, error: 'Не си в стая.' };
    if (room.hostUserId !== userId) return { ok: false, error: 'Само домакинът може да започне играта.' };
    if (room.game) return { ok: false, error: 'Мачът вече тече.' };
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
    socket.emit('room:state', this.state(room, room.hostUserId === userId));
  }

  disconnected(userId: number, graceMs = RECONNECT_GRACE_MS) {
    const room = this.byUser.get(userId);
    if (room?.game || (!room && !this.knockingAt.has(userId))) return;
    this.clearGrace(userId);
    this.graceTimers.set(
      userId,
      setTimeout(
        guarded('room grace', () => this.leave(userId)),
        graceMs,
      ),
    );
  }

  /**
   * The lobbies, for the next process to carry on (a deploy restarts the server: a class waiting for its code to fill
   * shouldn't have to start over). A match a room was playing has ended by now (the drain waits for it).
   */
  kept(): KeptRoom[] {
    return [...this.rooms.values()].map((r) => ({
      code: r.code,
      hostUserId: r.hostUserId,
      settings: r.settings,
      members: r.members,
      bots: r.bots,
      teams: [...r.teams],
      kicked: [...r.kicked],
      nicknames: [...r.nicknames],
      locked: r.locked,
      knocks: [...r.knocks],
      admitted: [...r.admitted],
    }));
  }

  /** The lobbies the last process kept: everyone in them gets RESTART_GRACE_MS to come back (their page reconnects). */
  restore(kept: KeptRoom[]) {
    for (const k of kept) {
      if (this.rooms.has(k.code) || !k.members.length) continue;
      const room: Room = {
        ...k,
        game: null,
        teams: new Map(k.teams),
        kicked: new Set(k.kicked),
        nicknames: new Map(k.nicknames),
        knocks: new Map(k.knocks),
        admitted: new Set(k.admitted),
      };
      this.rooms.set(room.code, room);
      for (const id of room.members) this.byUser.set(id, room);
      for (const id of room.knocks.keys()) this.knockingAt.set(id, room.code);
      for (const id of [...room.members, ...room.knocks.keys()]) this.disconnected(id, RESTART_GRACE_MS);
    }
  }

  /** For the live report: open rooms, how many play a match now, and the people in them. */
  counts() {
    let playing = 0;
    let people = 0;
    for (const r of this.rooms.values()) {
      if (r.game) playing++;
      people += r.members.length;
    }
    return { open: this.rooms.size, playing, people };
  }

  private add(room: Room, userId: number) {
    room.members.push(userId);
    room.admitted.add(userId);
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

  /** The host's copy names who's at the door; the others' doesn't (a name nobody let in stays off everyone's screen). */
  private broadcast(room: Room) {
    const host = `user:${room.hostUserId}`;
    this.io.to(`room:${room.code}`).except(host).emit('room:state', this.state(room));
    this.io.to(host).emit('room:state', this.state(room, true));
  }

  /** Off the room's door, with why (the room shut, no place, the host said no). */
  private turnAway(room: Room, userId: number, message: string) {
    room.knocks.delete(userId);
    if (this.knockingAt.get(userId) !== room.code) return;
    this.knockingAt.delete(userId);
    this.io.to(`user:${userId}`).emit('room:refused', { code: room.code, message });
  }

  /** Gone from the door they were at (they left, went elsewhere, or their connection didn't come back). */
  private stopKnocking(userId: number) {
    const code = this.knockingAt.get(userId);
    if (code === undefined) return;
    this.knockingAt.delete(userId);
    const room = this.rooms.get(code);
    if (room?.knocks.delete(userId)) this.broadcast(room);
  }

  /** `name`, or with the first number after it nobody in the room goes by („Мария 2“; „Играч 1“ from `from`). */
  private freeName(room: Room, name: string, from?: number): string {
    const taken = new Set(this.state(room).players.map((p) => p.name.toLocaleLowerCase('bg')));
    if (from === undefined && !taken.has(name.toLocaleLowerCase('bg'))) return name;
    for (let n = from ?? 2; ; n++) {
      const numbered = `${name.slice(0, 20 - String(n).length - 1)} ${n}`;
      if (!taken.has(numbered.toLocaleLowerCase('bg'))) return numbered;
    }
  }

  /** A member as they play here: under the name a guest picked for the room. */
  private human(room: Room, userId: number) {
    const h = buildHuman(userId, 'custom');
    const nickname = room.nicknames.get(userId);
    if (nickname) h.player.name = nickname;
    return h;
  }

  private state(room: Room, forHost = false): RoomState {
    return {
      code: room.code,
      hostId: `u${room.hostUserId}`,
      settings: room.settings,
      inGame: room.game !== null,
      locked: room.locked,
      knocking: forHost
        ? [...room.knocks].map(([id, nickname]) => ({
            id: memberId(id),
            name: nickname ?? getUser(id)?.username ?? '',
            isGuest: nickname !== null,
          }))
        : [],
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

/**
 * „Само водя“ is how a class plays: turned on, the room opens to every seat it can have (a class of 25 met „Стаята е
 * пълна“ at the 8th) — unless its size was chosen too, or knockouts keep it small.
 */
function forAClass(settings: RoomSettings, patch: Record<string, unknown>, wasPlaying: boolean): RoomSettings {
  const opens =
    wasPlaying &&
    !settings.hostPlays &&
    !settings.elimination &&
    patch.maxPlayers === undefined &&
    settings.maxPlayers === DEFAULT_ROOM_SETTINGS.maxPlayers;
  return opens ? { ...settings, maxPlayers: ROOM_LIMITS.maxPlayers[1] } : settings;
}

/** A guest's name for a room (ROOM_NICKNAME), tidied; null if it isn't one. */
export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string' || nicknameProblem(raw)) return null;
  return tidyNickname(raw);
}

const NICKNAME_ERROR = `Избери име за стаята: от ${ROOM_NICKNAME.min} до ${ROOM_NICKNAME.max} букви, цифри или интервали.`;
