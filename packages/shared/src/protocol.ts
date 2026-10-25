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
  daily: { day: string; played: boolean; streak: number };
  /** Season-end rewards the player hasn't seen yet. */
  seasonRewards: SeasonReward[];
  friendRequests: number;
  /** Verified address (used for password resets). */
  email: string | null;
  /** Address waiting for its verification link to be clicked. */
  pendingEmail: string | null;
}

// ─── Realtime ────────────────────────────────────────────────────────────────

export interface GamePlayer extends Loadout {
  /** Per-game id: "u<userId>" for humans, "b<n>" for bots. */
  id: string;
  userId: number | null;
  name: string;
  level: number;
  isBot: boolean;
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
  /** Someone gets knocked out after this question. */
  elimination: boolean;
  /** Ids of players who already locked in (for reconnects). */
  answered: string[];
}

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
  /** Леден удар: who got frozen. */
  targetId?: string;
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
  daily: { rank: number; total: number; streak: number } | null;
}

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
  'game:reveal': (p: RevealPayload) => void;
  'game:powerup': (p: PowerupEvent) => void;
  'game:reaction': (p: { playerId: string; emote: string }) => void;
  'game:presence': (p: { playerId: string; connected: boolean; left: boolean }) => void;
  'game:end': (p: GameEndPayload) => void;
  /** Something about your friends changed (refetch the list); `requests` is your pending friend-request count. */
  'friends:update': (p: { requests: number }) => void;
  invite: (i: Invite) => void;
  /** Achievements earned outside a match (friends, authoring, seasons). */
  achievements: (ids: string[]) => void;
  /** Your account changed server-side (e.g. renamed by a moderator); refetch /me. */
  'account:update': () => void;
  notice: (p: { kind: 'info' | 'error'; message: string }) => void;
  /** The server is restarting for an update: running matches finish, no new ones start until it's back. */
  'server:draining': (p: { message: string }) => void;
}

export interface ClientToServerEvents {
  'queue:join': (mode: QueueModeId, ack: Ack) => void;
  'queue:leave': () => void;
  'solo:start': (opts: { category: CategoryChoice }, ack: Ack) => void;
  'daily:start': (ack: Ack) => void;
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
}

export interface DailyInfo {
  day: string;
  endsAt: number;
  streak: number;
  /** Started today but not finished (a dropped attempt counts). */
  attempted: boolean;
  played: { score: number; correct: number; rank: number } | null;
  total: number;
  entries: LeaderboardEntry[];
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
}

/** Open reports about one question, for the moderation queue. */
export interface QuestionReportGroup {
  question: QuestionInfo;
  reports: { reason: QuestionReportReason; details: string; createdAt: number; reporter: string | null }[];
}

export type QuestionReportAction = 'dismiss' | 'hide';
