import type { CategoryChoice, CategoryId } from './categories';
import type { PowerupId, UnlockRef } from './cosmetics';
import type { ModeId, QueueModeId, RoomSettings, TeamId } from './modes';
import type { RankTierId } from './progression';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Loadout {
  avatar: string;
  frame: string;
  title: string;
}

export interface PublicUser extends Loadout {
  id: number;
  username: string;
  level: number;
  xp: number;
}

export interface SeasonReward {
  season: string;
  /** Best tier reached; null when the player didn't play enough ranked games. */
  tier: RankTierId | null;
  xp: number;
  unlocks: UnlockRef[];
}

export interface MeUser extends PublicUser {
  createdAt: number;
  achievements: string[];
  /** Current-season ratings. */
  ratings: Partial<Record<QueueModeId, number>>;
  dailyBonusAvailable: boolean;
  isAdmin: boolean;
  /** Best tier index ever finished a season at (-1 = none); unlocks season cosmetics. */
  bestSeasonTier: number;
  /** All-time totals, for the home card (the profile page has the full statistics). */
  stats: { games: number; wins: number; answered: number; correct: number };
  /** `shields`: missed days the streak can survive (earned every 7 days, at most 2). */
  daily: { day: string; played: boolean; streak: number; shields: number };
  quests: QuestsInfo;
  /** Playing as a guest: no name or password yet ("Запази прогреса си" turns it into a full account). */
  isGuest: boolean;
  /** Opted in to the evening "your streak is about to break" email. */
  streakReminders: boolean;
  /** Season-end rewards the player hasn't seen yet. */
  seasonRewards: SeasonReward[];
  friendRequests: number;
  /** Notes (AppNotification) the player hasn't seen yet: the count on the bell. */
  unreadNotifications: number;
  /** Verified address (used for password resets). */
  email: string | null;
  /** Mail to the verified address bounced or was marked as spam (the reminders were switched off). */
  emailBounced: boolean;
  /** Address waiting for its verification link to be clicked. */
  pendingEmail: string | null;
}

export interface QuestInfo {
  id: string;
  icon: string;
  text: string;
  goal: number;
  progress: number;
  xp: number;
  done: boolean;
}

/** Three small goals a day (Sofia time), plus a bonus for finishing all of them. */
export interface QuestsInfo {
  day: string;
  endsAt: number;
  quests: QuestInfo[];
  bonusXp: number;
  bonusDone: boolean;
}

// ─── Realtime ────────────────────────────────────────────────────────────────

export interface GamePlayer extends Loadout {
  /** Per-game id: "u<userId>" for humans, "b<n>" for bots. */
  id: string;
  userId: number | null;
  name: string;
  level: number;
  isBot: boolean;
  /** Playing on a guest account (no name of their own yet: not someone to add as a friend). */
  isGuest: boolean;
  rating: number | null;
  team: TeamId | null;
}

export interface Standing {
  id: string;
  score: number;
  correct: number;
  streak: number;
  rank: number;
  /** Question number (1-based) after which the player was knocked out. */
  eliminatedAt: number | null;
  left: boolean;
  connected: boolean;
}

export interface QuestionPayload {
  /** Stable question id (for reporting a mistake in it). */
  id: string;
  index: number;
  total: number;
  category: CategoryId;
  difficulty: Difficulty;
  q: string;
  options: string[];
  /** Username of the player who wrote it, for community questions. */
  author: string | null;
  durationMs: number;
  remainingMs: number;
  /** The reading window (readingMs): the speed bonus starts to drain after it. */
  readMs: number;
  /** Someone gets knocked out after this question. */
  elimination: boolean;
  /** Ids of players who already locked in (for reconnects). */
  answered: string[];
  /**
   * Only when a (re)connecting client is brought up to speed: where you stand on this question. `remainingMs` then
   * already counts your "Още време".
   */
  mine?: {
    choice: number | null;
    removed: number[];
    doubled: boolean;
    retryArmed: boolean;
    retryPrompt: boolean;
    extraMs: number;
    powerupThisQuestion: boolean;
  };
}

/** Why the server didn't take an answer the client sent: too late, or an option a коз removed. */
export type AnswerRejection = 'late' | 'removed';

export interface PlayerResult {
  choice: number | null;
  correct: boolean;
  points: number;
  timeMs: number | null;
  streak: number;
  doubled: boolean;
  /** Got it right on the "Втори шанс" retry. */
  retried: boolean;
}

export interface RevealPayload {
  index: number;
  correct: number;
  results: Record<string, PlayerResult>;
  standings: Standing[];
  eliminated: string[];
  nextInMs: number;
  /** "Знаеше ли?" behind this question's answer, if it has one: sent with the reveal, never before (it could give the
   * answer away). */
  fact: string | null;
}

export interface GameStartPayload {
  gameId: string;
  mode: ModeId;
  ranked: boolean;
  roomCode: string | null;
  players: GamePlayer[];
  youId: string;
  totalQuestions: number;
  timeMs: number;
  category: CategoryChoice;
  teams: boolean;
  eliminationSchedule: number[];
  powerups: PowerupId[];
  usedPowerups: PowerupId[];
  emotes: string[];
  standings: Standing[];
  /** Countdown before the first question (0 when re-syncing mid-game). */
  startsInMs: number;
}

export interface PowerupEvent {
  playerId: string;
  powerup: PowerupId;
  /** 50/50: options removed (sent only to the user). */
  removed?: number[];
  /** Още време: extra milliseconds for the user. */
  extraMs?: number;
}

export interface XpLine {
  label: string;
  amount: number;
}

export interface MatchRewards {
  xpGained: number;
  breakdown: XpLine[];
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  achievements: string[];
  unlocks: UnlockRef[];
  rating: { before: number; after: number } | null;
  /** Why a ranked match left the rating as it was (`rating` is null then). */
  unrated: UnratedReason | null;
  /** `shieldsUsed`: missed days a streak shield covered; `shieldEarned`: this run completed a week. */
  // `rank` is null for a run on questions of its own (a guest, or an account made today: see the server's daily.ts).
  daily: { rank: number | null; total: number; streak: number; shieldsUsed: number; shieldEarned: boolean } | null;
  /** A challenge-link run: where it placed among everyone who played that link. */
  challenge: { id: string; rank: number; total: number } | null;
}

/**
 * `pair`: these two already played their rated games today (the win-trading guard). `guest`: guests play people
 * unrated. `new`: your account is new (RATED_AFTER), `new_rival`: the person you played is. `no_contest`: the other side
 * walked out before the match got going. `cut`: we ended the match early (an update that couldn't wait, or a fault on
 * our side).
 */
export type UnratedReason = 'pair' | 'guest' | 'new' | 'new_rival' | 'no_contest' | 'cut';

export interface FinalStanding extends Standing {
  placement: number;
}

export interface GameEndPayload {
  gameId: string;
  mode: ModeId;
  ranked: boolean;
  roomCode: string | null;
  standings: FinalStanding[];
  /** Team totals, winner first, in team games. */
  teamScores: { team: TeamId; score: number }[] | null;
  rewards: MatchRewards | null;
  /** The other side walked out before the match got going: it counts for nobody who stayed. */
  noContest: boolean;
}

export interface QueueStatus {
  mode: QueueModeId;
  found: number;
  needed: number;
  waitedMs: number;
  /** Milliseconds until bots fill the remaining seats. Null when bots are disabled. */
  botFillMs: number | null;
}

export interface RoomPlayer extends GamePlayer {
  isHost: boolean;
}

export interface RoomState {
  code: string;
  hostId: string;
  settings: RoomSettings;
  players: RoomPlayer[];
  inGame: boolean;
}

export interface LobbyStats {
  online: number;
  inGame: number;
  queues: Record<QueueModeId, number>;
  /** Ranked queues that are open. */
  modes: QueueModeId[];
  /** The web app build the server hosts (null in development): a tab running another one reloads when it's safe. */
  build: string | null;
}

/** After a match with other people: who wants to play the same opponents again. */
export interface RematchState {
  gameId: string;
  /** Player ids (as in the match) who asked for a rematch. */
  ready: string[];
  /** Everyone the rematch needs. */
  players: string[];
  /** Someone declined or left; the offer is over. */
  cancelled: boolean;
}

export type Presence = 'offline' | 'online' | 'queue' | 'room' | 'game';

export interface Invite {
  id: string;
  from: PublicUser;
  roomCode: string;
  kind: 'room' | 'challenge';
  expiresAt: number;
}

export type AckResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T extends object = object> = (res: AckResult<T>) => void;

export interface ServerToClientEvents {
  'lobby:stats': (s: LobbyStats) => void;
  'queue:status': (s: QueueStatus | null) => void;
  'room:state': (s: RoomState | null) => void;
  'game:start': (p: GameStartPayload) => void;
  'game:question': (p: QuestionPayload) => void;
  'game:answered': (p: { playerId: string }) => void;
  'game:retry': (p: { wrong: number }) => void;
  /** An answer you sent wasn't taken (the client showed it as locked in). */
  'game:rejected': (p: { index: number; reason: AnswerRejection }) => void;
  'game:reveal': (p: RevealPayload) => void;
  'game:powerup': (p: PowerupEvent) => void;
  'game:reaction': (p: { playerId: string; emote: string }) => void;
  'game:presence': (p: { playerId: string; connected: boolean; left: boolean }) => void;
  'game:end': (p: GameEndPayload) => void;
  /** A one-attempt run we cut short: no result, and the attempt can be played again. */
  'game:aborted': (p: { gameId: string; message: string }) => void;
  /** Something about your friends changed (refetch the list); `requests` is your pending friend-request count. */
  'friends:update': (p: { requests: number }) => void;
  invite: (i: Invite) => void;
  /** Achievements earned outside a match (friends, authoring, seasons). */
  achievements: (ids: string[]) => void;
  /** Your account changed server-side (e.g. renamed by a moderator); refetch /me. */
  'account:update': () => void;
  /** A note kept until it's seen (see AppNotification), with how many are now unseen. */
  notification: (p: { item: AppNotification; unread: number }) => void;
  notice: (p: { kind: 'info' | 'error'; message: string }) => void;
  /** The server is restarting for an update: running matches finish, no new ones start until it's back. */
  'server:draining': (p: { message: string }) => void;
  'rematch:state': (p: RematchState) => void;
}

export interface ClientToServerEvents {
  'queue:join': (mode: QueueModeId, ack: Ack) => void;
  'queue:leave': () => void;
  'solo:start': (opts: { category: CategoryChoice }, ack: Ack) => void;
  'daily:start': (ack: Ack) => void;
  /** Plays a challenge link (`id`), or creates a new one and plays it first (no `id`). */
  'challenge:start': (p: { id?: string }, ack: Ack<{ id: string }>) => void;
  'rematch:request': (p: { gameId: string }) => void;
  'rematch:decline': (p: { gameId: string }) => void;
  'room:create': (settings: Partial<RoomSettings>, ack: Ack<{ code: string }>) => void;
  'room:join': (code: string, ack: Ack<{ code: string }>) => void;
  'room:leave': () => void;
  'room:settings': (settings: Partial<RoomSettings>) => void;
  'room:bot': (action: 'add' | 'remove') => void;
  'room:kick': (playerId: string) => void;
  'room:team': (playerId: string) => void;
  'room:start': (ack: Ack) => void;
  'invite:send': (p: { userId: number }, ack: Ack) => void;
  'invite:decline': (p: { inviteId: string }) => void;
  'friends:challenge': (p: { userId: number }, ack: Ack<{ code: string }>) => void;
  'game:answer': (p: { index: number; choice: number }) => void;
  'game:powerup': (p: { index: number; powerup: PowerupId }) => void;
  'game:react': (emote: string) => void;
  'game:leave': () => void;
  /** A run played alone: stop on this question's fact, to read it. The next question waits for game:resume. */
  'game:hold': (p: { index: number }, ack: Ack) => void;
  'game:resume': () => void;
}

// ─── REST ────────────────────────────────────────────────────────────────────

export type Friendship = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';

export interface ProfileStats {
  user: PublicUser & { createdAt: number };
  friendship: Friendship;
  overview: {
    gamesPlayed: number;
    multiplayerGames: number;
    wins: number;
    questionsAnswered: number;
    correctAnswers: number;
    bestStreak: number;
    fastestCorrectMs: number | null;
    avgCorrectMs: number | null;
    bestSoloScore: number;
    powerupsUsed: number;
    dailyStreak: number;
    bestDailyStreak: number;
    questionsApproved: number;
  };
  modes: { mode: ModeId; games: number; wins: number; avgPlacement: number | null; rating: number | null }[];
  categories: { category: CategoryId; answered: number; correct: number }[];
  recent: {
    matchId: string;
    mode: ModeId;
    endedAt: number;
    placement: number;
    players: number;
    score: number;
    correct: number;
    questions: number;
    xp: number;
    ratingDelta: number | null;
  }[];
  achievements: { id: string; unlockedAt: number }[];
  seasons: { season: string; tier: RankTierId | null }[];
}

export interface AchievementProgress {
  id: string;
  unlockedAt: number | null;
  progress: number | null;
}

export type LeaderboardBoard = 'level' | 'daily' | QueueModeId;

export interface LeaderboardEntry {
  rank: number;
  user: PublicUser;
  value: number;
  games?: number;
  wins?: number;
  correct?: number;
}

export interface LeaderboardResponse {
  board: LeaderboardBoard;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  /** Ranked boards are per season. */
  season: { id: string; name: string; endsAt: number } | null;
  /** The daily board: today's results of you and your friends, ranked among yourselves. */
  friends?: LeaderboardEntry[];
}

export interface DailyInfo {
  day: string;
  endsAt: number;
  streak: number;
  /** Started today but not finished (a dropped attempt counts). */
  attempted: boolean;
  /**
   * Today's run is on questions of its own, not the shared set, and isn't on the board: a guest's, or an account's made
   * today (one made to read the answers off before playing with another would have been).
   */
  ownSet: boolean;
  /** `rank` is null for a run on questions of its own (`ownSet`). */
  played: { score: number; correct: number; rank: number | null } | null;
  total: number;
  entries: LeaderboardEntry[];
  /** Today's results of you and your friends, ranked among yourselves (empty for a guest, who has no friends here). */
  friends: LeaderboardEntry[];
}

export interface SeasonInfo {
  id: string;
  name: string;
  endsAt: number;
  modes: { mode: QueueModeId; rating: number; peak: number; games: number; wins: number }[];
  history: { season: string; tier: RankTierId | null; xp: number }[];
}

export interface FriendEntry {
  user: PublicUser;
  presence: Presence;
  since: number;
}

export interface FriendsResponse {
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
}

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface QuestionDraft {
  category: CategoryId;
  difficulty: Difficulty;
  q: string;
  options: string[];
  answer: number;
}

export interface Submission extends QuestionDraft {
  id: number;
  status: SubmissionStatus;
  reason: string | null;
  createdAt: number;
  reviewedAt: number | null;
  author: PublicUser;
}

export const SUBMISSION_RULES = {
  minLevel: 3,
  maxPending: 10,
  question: [10, 150],
  option: [1, 45],
  /** XP the author gets when a question is approved. */
  approvedXp: 100,
} as const;

export const REPORT_REASONS = [
  { id: 'name', label: 'Обидно потребителско име' },
  { id: 'behavior', label: 'Обидно поведение' },
  { id: 'cheating', label: 'Измама или нечестна игра' },
  { id: 'other', label: 'Друго' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

/** Open reports about one player, for the moderation queue. */
export interface ReportGroup {
  target: PublicUser & { bannedUntil: number | null };
  reports: { id: number; reason: ReportReason; details: string | null; createdAt: number; reporter: string | null }[];
}

export type ModerationAction =
  | { action: 'dismiss' }
  | { action: 'rename'; username: string }
  | { action: 'ban'; days: number | null; reason: string };

/** What a player can flag about a question. */
export const QUESTION_REPORT_REASONS = [
  { id: 'wrong', label: 'Отговорът, отбелязан като верен, е грешен' },
  { id: 'ambiguous', label: 'Повече от един отговор е верен' },
  { id: 'outdated', label: 'Информацията е остаряла' },
  { id: 'typo', label: 'Правописна или езикова грешка' },
  { id: 'fact', label: 'Грешка в „Знаеше ли?“' },
  { id: 'other', label: 'Друго' },
] as const;

export type QuestionReportReason = (typeof QUESTION_REPORT_REASONS)[number]['id'];

export interface QuestionInfo {
  id: string;
  category: CategoryId;
  difficulty: Difficulty;
  q: string;
  options: string[];
  answer: number;
  /** Username of a community question's author. */
  author: string | null;
  /** Hidden from new matches by a moderator. */
  hidden: boolean;
  /** Its "Знаеше ли?" and where that can be checked (moderators judge reports about it). */
  fact: string | null;
  factSource: string | null;
}

/** Open reports about one question, for the moderation queue. */
export interface QuestionReportGroup {
  question: QuestionInfo;
  reports: { id: number; reason: QuestionReportReason; details: string; createdAt: number; reporter: string | null }[];
}

export type QuestionReportAction = 'dismiss' | 'hide';

/** What the answer log says, for moderators: play no person could manage, and questions whose label is off. */
export interface PlayCheck {
  /** Medium and hard questions answered right nearly always and fast (the rules are in `rules`). */
  suspicious: {
    user: PublicUser & { bannedUntil: number | null };
    answers: number;
    accuracy: number;
    medianCorrectMs: number;
    lastAt: number;
  }[];
  /**
   * `wrong`: so few get it right that the marked answer may be the wrong one; `harder`/`easier`: people find it much
   * harder or easier than its difficulty says.
   */
  questions: {
    question: QuestionInfo;
    verdict: 'wrong' | 'harder' | 'easier';
    answered: number;
    correctShare: number;
    avgCorrectMs: number | null;
  }[];
  rules: { minAnswers: number; minAccuracy: number; maxMedianMs: number; questionMinAnswers: number; logDays: number };
}

// ─── Challenge links ─────────────────────────────────────────────────────────

export interface ChallengeEntry {
  rank: number;
  /** null once the account is gone. */
  user: PublicUser | null;
  score: number;
  correct: number;
  timeMs: number;
  you: boolean;
}

export interface ChallengeInfo {
  id: string;
  creator: PublicUser | null;
  createdAt: number;
  expiresAt: number;
  questions: number;
  /** Finished runs, best first. */
  entries: ChallengeEntry[];
  /** You started it (one attempt each). */
  attempted: boolean;
  expired: boolean;
}

/** What a signed-out visitor sees on a challenge link. */
export interface ChallengePreview {
  id: string;
  creator: Pick<PublicUser, 'username' | 'avatar' | 'frame'> | null;
  topScore: number | null;
  players: number;
  expired: boolean;
}

export interface MyChallenge {
  id: string;
  createdAt: number;
  expiresAt: number;
  players: number;
  /** Your own score on it (null if you haven't finished it). */
  myScore: number | null;
  leader: { username: string; score: number } | null;
}

/** Admin → Статистика: daily counters (newest day first) and totals. */
/** A note kept for a player until they've seen it: something that happened while they may have been away. */
export interface AppNotification {
  id: number;
  icon: string;
  text: string;
  /** Where it leads (a challenge link's page, the questions you submitted…). */
  link: string | null;
  createdAt: number;
  read: boolean;
}

export interface LaunchStats {
  days: { day: string; values: Partial<Record<string, number>> }[];
  totals: { accounts: number; guests: number; matches: number };
}

/**
 * What every page knows about the site: who runs it (the legal pages, the footer), where its source is, and how many
 * questions it has (the landing page). The server puts it in each page it sends; /api/legal has it too.
 */
export interface SiteInfo {
  name: string | null;
  address: string | null;
  email: string;
  emailProvider: string | null;
  hosting: string | null;
  /** Where the off-site backups are kept, when that's not the hosting provider. */
  backups: string | null;
  /** Forwards mail sent to the contact address, if a service does. */
  inbox: string | null;
  /** Where this site's source code is published (offered in the footer, as the AGPL asks of hosted copies). */
  sourceUrl: string | null;
  /** The commit this server runs (the source offer links that exact version). */
  release: string | null;
  /** Questions in play, rounded down to the hundred ("над 1 900 въпроса"). */
  questions: number;
}
