import { randomBytes } from 'node:crypto';
import { setImmediate as yieldToMatches } from 'node:timers/promises';
import {
  dayKey,
  GROUPS,
  type GroupEntry,
  type GroupInfo,
  type GroupPreview,
  type GroupSummary,
  ordinal,
  shiftDay,
  weekEndsAt,
  weekStart,
} from '@quiz/shared';
import { all, one, run, tx } from './db';
import { textProblem } from './names';
import { notify } from './notifications';
import { count } from './stats';
import { getUser, NOT_BANNED, toPublicUser, type UserRow } from './users';

/**
 * Groups (GROUPS): a class, an office, a family with an invite link and a weekly board of „Въпросите на деня“ — each
 * member's best few daily scores of the week (Monday to Sunday, Sofia time), summed. Each finished week's winner is
 * kept (`group_weeks`) and wears a 👑 in the group all the next week.
 */

interface GroupRow {
  id: number;
  name: string;
  code: string;
  owner_id: number | null;
  created_at: number;
}

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const getGroup = (id: number) => one<GroupRow>('SELECT * FROM player_groups WHERE id = ?', id);
const byCode = (code: string) => one<GroupRow>('SELECT * FROM player_groups WHERE code = ?', code);
const isMember = (groupId: number, userId: number) =>
  !!one('SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
const memberCount = (groupId: number) =>
  one<{ n: number }>('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', groupId)!.n;
const newCode = () => randomBytes(6).toString('base64url');
/** "31 450", as Bulgarian writes a big number. */
const points = (n: number) => n.toLocaleString('bg-BG');

/** The groups a player is in, oldest membership first. */
export const groupIdsOf = (userId: number) =>
  all<{ group_id: number }>(
    'SELECT group_id FROM group_members WHERE user_id = ? ORDER BY joined_at, group_id',
    userId,
  ).map((r) => r.group_id);

/** Groups nobody is left in go (the last member left, or deleted their account). */
export function dropEmptyGroups(ids: number[]) {
  for (const id of ids)
    run(
      'DELETE FROM player_groups WHERE id = ? AND NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = ?)',
      id,
      id,
    );
}

/**
 * A group's name as typed, tidied: one space between words, no control or invisible characters (a name that reads
 * differently from what it is). Null if it's still too short or too long.
 */
export function cleanGroupName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // The zero-width joiner stays: it holds emoji like 👨‍👩‍👧 together.
  const name = raw
    .normalize('NFC')
    .replace(/(?!\u200d)\p{C}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const length = [...name].length;
  return length >= GROUPS.name[0] && length <= GROUPS.name[1] ? name : null;
}

const NAME_ERROR = `Името на групата е от ${GROUPS.name[0]} до ${GROUPS.name[1]} знака.`;
const FULL_ERROR = `Групата е пълна (най-много ${GROUPS.maxMembers} души).`;
const TOO_MANY = `Можеш да си в най-много ${GROUPS.perPlayer} групи.`;

export function createGroup(userId: number, rawName: unknown): Result<{ id: number }> {
  const name = cleanGroupName(rawName);
  if (!name) return { ok: false, error: NAME_ERROR };
  const problem = textProblem(name, 'Името на групата');
  if (problem) return { ok: false, error: problem };
  if (groupIdsOf(userId).length >= GROUPS.perPlayer) return { ok: false, error: TOO_MANY };
  const now = Date.now();
  const id = tx(() => {
    const groupId = Number(
      run(
        'INSERT INTO player_groups (name, code, owner_id, created_at) VALUES (?, ?, ?, ?)',
        name,
        newCode(),
        userId,
        now,
      ).lastInsertRowid,
    );
    run('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)', groupId, userId, now);
    return groupId;
  });
  return { ok: true, id };
}

/** What an invite link shows anyone who opens it (null: no such link). */
export function groupPreview(code: string, viewerId: number | null): GroupPreview | null {
  const g = byCode(code);
  if (!g) return null;
  const members = memberCount(g.id);
  return {
    name: g.name,
    members,
    owner: g.owner_id === null ? null : (getUser(g.owner_id)?.username ?? null),
    memberOf: viewerId !== null && isMember(g.id, viewerId) ? g.id : null,
    full: members >= GROUPS.maxMembers,
  };
}

export function joinGroup(userId: number, code: string): Result<{ id: number }> {
  const g = byCode(code);
  if (!g) return { ok: false, error: 'Линкът към групата вече не е валиден. Поискай нов.' };
  if (isMember(g.id, userId)) return { ok: true, id: g.id };
  if (memberCount(g.id) >= GROUPS.maxMembers) return { ok: false, error: FULL_ERROR };
  if (groupIdsOf(userId).length >= GROUPS.perPlayer) return { ok: false, error: TOO_MANY };
  run('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)', g.id, userId, Date.now());
  count('link_uses:group');
  return { ok: true, id: g.id };
}

/**
 * Takes a player out of a group: one leaving, or one its owner removes. An owner who leaves hands the group to whoever
 * has been in it longest; the last one out takes it with them.
 */
export function leaveGroup(groupId: number, userId: number) {
  tx(() => {
    run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
    const g = getGroup(groupId);
    if (g && g.owner_id === userId) {
      const next = one<{ user_id: number }>(
        'SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at, user_id LIMIT 1',
        groupId,
      );
      run('UPDATE player_groups SET owner_id = ? WHERE id = ?', next?.user_id ?? null, groupId);
    }
    dropEmptyGroups([groupId]);
  });
}

/** Whether the player runs the group: its owner, or (an owner gone with their account) its longest member. */
function runsGroup(g: GroupRow, userId: number) {
  if (g.owner_id !== null) return g.owner_id === userId;
  const first = one<{ user_id: number }>(
    'SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at, user_id LIMIT 1',
    g.id,
  );
  return first?.user_id === userId;
}

/** What only whoever runs a group may do: rename it, give it a new link, remove someone, delete it. */
export function manageGroup(
  groupId: number,
  userId: number,
  action: { rename: unknown } | { newCode: true } | { remove: number } | { delete: true },
): Result {
  const g = getGroup(groupId);
  if (!g || !isMember(groupId, userId)) return { ok: false, error: 'Няма такава група.' };
  if (!runsGroup(g, userId)) return { ok: false, error: 'Само създателят на групата може това.' };
  if ('rename' in action) {
    const name = cleanGroupName(action.rename);
    if (!name) return { ok: false, error: NAME_ERROR };
    const problem = textProblem(name, 'Името на групата');
    if (problem) return { ok: false, error: problem };
    run('UPDATE player_groups SET name = ? WHERE id = ?', name, groupId);
  } else if ('newCode' in action) {
    run('UPDATE player_groups SET code = ? WHERE id = ?', newCode(), groupId);
  } else if ('remove' in action) {
    if (action.remove === userId) return { ok: false, error: 'За да излезеш, използвай „Напусни групата“.' };
    leaveGroup(groupId, action.remove);
  } else {
    run('DELETE FROM player_groups WHERE id = ?', groupId);
  }
  return { ok: true };
}

// ─── The weekly board ────────────────────────────────────────────────────────

interface Standing {
  user: UserRow;
  score: number;
  timeMs: number;
  days: number;
  today: number | null;
}

/**
 * A week's board: each member's best GROUPS.bestDays daily scores that week, summed (ties: less time over those days),
 * and the members who haven't played that week yet. Banned players are left out.
 */
function weekBoard(groupId: number, monday: string, today = dayKey()) {
  const members = all<UserRow>(
    `SELECT u.* FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND ${NOT_BANNED}
     ORDER BY m.joined_at, u.id`,
    groupId,
  );
  const runs = all<{ user_id: number; day: string; score: number; time_ms: number }>(
    `SELECT d.user_id, d.day, d.score, d.time_ms FROM daily_results d
     JOIN group_members m ON m.user_id = d.user_id AND m.group_id = ?
     WHERE d.day >= ? AND d.day <= ? AND d.finished_at IS NOT NULL`,
    groupId,
    monday,
    shiftDay(monday, 6),
  );
  const byUser = new Map<number, typeof runs>();
  for (const r of runs) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const played: Standing[] = [];
  const waiting: UserRow[] = [];
  for (const user of members) {
    const mine = byUser.get(user.id);
    if (!mine) {
      waiting.push(user);
      continue;
    }
    const best = mine.toSorted((a, b) => b.score - a.score || a.time_ms - b.time_ms).slice(0, GROUPS.bestDays);
    played.push({
      user,
      score: best.reduce((sum, r) => sum + r.score, 0),
      timeMs: best.reduce((sum, r) => sum + r.time_ms, 0),
      days: mine.length,
      today: mine.find((r) => r.day === today)?.score ?? null,
    });
  }
  played.sort((a, b) => b.score - a.score || a.timeMs - b.timeMs || a.user.id - b.user.id);
  return { played, waiting };
}

/** Places on a board: equal score and time share one. */
function ranks(played: Standing[]) {
  return played.map((s, i) => {
    let rank = i + 1;
    while (rank > 1 && played[rank - 2].score === s.score && played[rank - 2].timeMs === s.timeMs) rank--;
    return rank;
  });
}

/**
 * Settles a finished week: its winner (none if nobody played) is kept, and whoever played hears how it ended. Once per
 * group and week (whoever gets there first: the upkeep, or the group's page after the week turned). Returns whether
 * this call did it.
 */
export function settleWeek(groupId: number, monday: string, now = Date.now()): boolean {
  const g = getGroup(groupId);
  // Not before the week is over, and not a week from before the group.
  if (!g || now < weekEndsAt(monday) || g.created_at >= weekEndsAt(monday)) return false;
  const { played } = weekBoard(groupId, monday, dayKey(now));
  const winner = played[0] ?? null;
  const { changes } = run(
    'INSERT OR IGNORE INTO group_weeks (group_id, week, winner_id, score) VALUES (?, ?, ?, ?)',
    groupId,
    monday,
    winner?.user.id ?? null,
    winner?.score ?? 0,
  );
  if (!Number(changes)) return false;
  const places = ranks(played);
  for (const [i, s] of played.entries()) {
    const text =
      s === winner
        ? `Спечели седмицата в „${g.name}“ с ${points(s.score)} т.! Короната 👑 е твоя цяла седмица.`
        : `Седмицата в „${g.name}“ свърши: ${ordinal(places[i])} място. Спечели ${winner!.user.username} с ${points(winner!.score)} т.`;
    notify(s.user.id, { icon: s === winner ? '👑' : '🏁', text, link: `/groups/${groupId}` });
  }
  return true;
}

/** Last week's winner in each group, settling the week first if nobody has yet. */
function crowned(groupId: number, now = Date.now()): number | null {
  const lastWeek = shiftDay(weekStart(dayKey(now)), -7);
  settleWeek(groupId, lastWeek, now);
  return (
    one<{ winner_id: number | null }>(
      'SELECT winner_id FROM group_weeks WHERE group_id = ? AND week = ?',
      groupId,
      lastWeek,
    )?.winner_id ?? null
  );
}

/** Groups settled per upkeep run: the rest wait 15 minutes. */
const SETTLE_BATCH = 500;
/** Each settled group tells every member: the matches going on get their turn after this many. */
const SETTLE_TURN = 20;

/**
 * The upkeep's part: settles the week just finished in every group that hasn't had it settled. Returns how many. Once
 * every group's is, the week is noted as done: the groups aren't looked through again until the next one ends.
 */
export async function settleGroupWeeks(now = Date.now()): Promise<number> {
  const lastWeek = shiftDay(weekStart(dayKey(now)), -7);
  if (one("SELECT 1 AS x FROM settings WHERE key = 'groups_settled' AND value = ?", lastWeek)) return 0;
  const due = all<{ id: number }>(
    `SELECT id FROM player_groups g WHERE created_at < ?
     AND NOT EXISTS (SELECT 1 FROM group_weeks w WHERE w.group_id = g.id AND w.week = ?) LIMIT ?`,
    weekEndsAt(lastWeek),
    lastWeek,
    SETTLE_BATCH,
  );
  let settled = 0;
  for (const [i, { id }] of due.entries()) {
    if (tx(() => settleWeek(id, lastWeek, now))) settled++;
    if (i % SETTLE_TURN === SETTLE_TURN - 1) await yieldToMatches();
  }
  if (due.length < SETTLE_BATCH)
    run(
      "INSERT INTO settings (key, value) VALUES ('groups_settled', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      lastWeek,
    );
  return settled;
}

/** The player's groups, for the home card and the list: where they stand this week, and who leads. */
export function myGroups(userId: number, now = Date.now()): GroupSummary[] {
  const monday = weekStart(dayKey(now));
  return groupIdsOf(userId).map((id) => {
    const g = getGroup(id)!;
    const { played } = weekBoard(id, monday, dayKey(now));
    const places = ranks(played);
    const mine = played.findIndex((s) => s.user.id === userId);
    const leader = played[0];
    return {
      id,
      name: g.name,
      members: memberCount(id),
      you: mine < 0 ? null : { rank: places[mine], score: played[mine].score },
      leader: leader ? { username: leader.user.username, score: leader.score, you: leader.user.id === userId } : null,
      crown: crowned(id, now) === userId,
    };
  });
}

/** A group's page, for its members (null for anyone else). */
export function groupInfo(groupId: number, userId: number, now = Date.now()): GroupInfo | null {
  const g = getGroup(groupId);
  if (!g || !isMember(groupId, userId)) return null;
  const monday = weekStart(dayKey(now));
  const crown = crowned(groupId, now);
  const { played, waiting } = weekBoard(groupId, monday, dayKey(now));
  const places = ranks(played);
  const entries: GroupEntry[] = played.map((s, i) => ({
    rank: places[i],
    user: toPublicUser(s.user),
    score: s.score,
    days: s.days,
    today: s.today,
    crown: s.user.id === crown,
  }));
  const owner = g.owner_id === null ? null : getUser(g.owner_id);
  const history = all<{ week: string; score: number } & Partial<UserRow>>(
    `SELECT w.week, w.score, u.* FROM group_weeks w LEFT JOIN users u ON u.id = w.winner_id
     WHERE w.group_id = ? ORDER BY w.week DESC LIMIT 12`,
    groupId,
  );
  return {
    id: g.id,
    name: g.name,
    code: g.code,
    owner: owner ? toPublicUser(owner) : null,
    isOwner: runsGroup(g, userId),
    members: memberCount(groupId),
    week: {
      start: monday,
      endsAt: weekEndsAt(monday),
      entries,
      waiting: waiting.map((u) => toPublicUser(u)),
    },
    history: history.map((h) => ({
      week: h.week,
      winner: h.id ? toPublicUser(h as UserRow) : null,
      score: h.score,
    })),
  };
}
