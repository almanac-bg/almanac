import {
  dayKey,
  EVENING,
  type EveningInfo,
  type EveningNight,
  type EveningStatus,
  levelFromXp,
  shiftDay,
  sofiaTimeOn,
  TITLES,
} from '@quiz/shared';
import { config } from './config';
import { all, one, run } from './db';
import { getUser, NOT_BANNED, toPublicUser, type UserRow } from './users';

/**
 * „Вечерен Роял“ (EVENING): one big match a day at config.eveningAt, Sofia time. What it leaves behind: each person's
 * place (`evening_results`), the night's top on the home page until the next evening, the champion's title for a
 * day, and a frame for EVENING.winsForFrame wins.
 */

/** When the evening of a day starts (null: there's no evening Роял). */
export function eveningStartsAt(day: string): number | null {
  const at = config.eveningAt;
  return at ? sofiaTimeOn(day, at.hour, at.minute, at.second) : null;
}

/** Each person's place in an evening match. Call inside the match's transaction. */
export function recordEvening(day: string, userId: number, placement: number, score: number, players: number) {
  run(
    `INSERT INTO evening_results (day, user_id, placement, score, players) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (day, user_id) DO UPDATE SET placement = excluded.placement, score = excluded.score,
       players = excluded.players`,
    day,
    userId,
    placement,
    score,
    players,
  );
}

/** The latest evening that has been played (started before `now`): its top and how many played. */
export function lastNight(now = Date.now()): EveningNight | null {
  const today = dayKey(now);
  const start = eveningStartsAt(today);
  const day = start !== null && now >= start ? today : shiftDay(today, -1);
  const rows = all<UserRow & { placement: number; score: number; players: number }>(
    `SELECT u.*, r.placement, r.score, r.players FROM evening_results r JOIN users u ON u.id = r.user_id
     WHERE r.day = ? AND ${NOT_BANNED} ORDER BY r.placement, r.score DESC LIMIT ?`,
    day,
    EVENING.top,
  );
  if (!rows.length) return null;
  const players = one<{ n: number }>('SELECT COUNT(*) AS n FROM evening_results WHERE day = ?', day)!.n;
  return {
    day,
    players,
    top: rows.map((r) => ({ placement: r.placement, user: toPublicUser(r), score: r.score })),
  };
}

/** Who holds „Шампион на вечерта“ now: whoever won an evening that started under EVENING.titleHours ago. */
export function champions(now = Date.now()): number[] {
  const since = now - EVENING.titleHours * 60 * 60_000;
  const days = [dayKey(now), shiftDay(dayKey(now), -1)].filter((d) => {
    const start = eveningStartsAt(d);
    return start !== null && start <= now && start > since;
  });
  if (!days.length) return [];
  return all<{ user_id: number }>(
    `SELECT user_id FROM evening_results WHERE placement = 1 AND day IN (${days.map(() => '?').join(',')})`,
    ...days,
  ).map((r) => r.user_id);
}

export const isChampion = (userId: number, now = Date.now()) => champions(now).includes(userId);

export const eveningWins = (userId: number) =>
  one<{ n: number }>('SELECT COUNT(*) AS n FROM evening_results WHERE user_id = ? AND placement = 1', userId)!.n;

/** The champion's title is worn for a day: whoever still wears it after that goes back to their best level's title. */
export function retireChampionTitles(now = Date.now()): number {
  const holders = new Set(champions(now));
  const wearing = all<UserRow>("SELECT * FROM users WHERE title = 'evening_champion'").filter(
    (u) => !holders.has(u.id),
  );
  for (const u of wearing) {
    const level = levelFromXp(getUser(u.id)!.xp);
    const best = TITLES.filter((t) => 'level' in t.req && t.req.level <= level).at(-1)?.id ?? 'rookie';
    run('UPDATE users SET title = ? WHERE id = ?', best, u.id);
  }
  return wearing.length;
}

/** The lobby, once the realtime server has made it (game/eveningLobby.ts): what /api/evening reports. */
let lobby: { status(userId: number | null): EveningStatus | null } | null = null;
export const setEveningLobby = (l: typeof lobby) => {
  lobby = l;
};

/** Tonight's evening as a player sees it (whether they're in its lobby), and the last one's top. */
export const eveningInfo = (userId: number): EveningInfo => ({
  status: lobby?.status(userId) ?? null,
  lastNight: lastNight(),
});
