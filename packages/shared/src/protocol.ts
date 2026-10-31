import type { CategoryChoice, CategoryId } from './categories';
import type { PowerupId, UnlockRef } from './cosmetics';
import type { ImageCredit, OrderDirection, QuestionImage } from './formats';
import type { CategoryMastery } from './mastery';
import type { ModeId, QueueModeId, RoomSettings, TeamId } from './modes';
import type { NumberInput } from './numbers';
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
  /** Staff: the owner (decides about moderators, keeps the bank and the numbers) or a moderator. */
  staffRole: 'owner' | 'moderator' | null;
  /** Best tier index ever finished a season at (-1 = none); unlocks season cosmetics. */
  bestSeasonTier: number;
  /** All-time totals, for the home card (the profile page has the full statistics). */
  stats: { games: number; wins: number; answered: number; correct: number };
  /** `shields`: missed days the streak can survive (earned every 7 days, at most 2). */
  daily: { day: string; played: boolean; streak: number; shields: number };
  quests: QuestsInfo;
  /** Playing as a guest: no name or password yet ("Запази прогреса си" turns it into a full account). */
  isGuest: boolean;
  /** A guest made to join a room from its link (a pupil in a class): erased within an hour of leaving the site. */
  roomGuest: boolean;
  /** Opted in to the evening "your streak is about to break" email. */
  streakReminders: boolean;
  /** The opt-in „X те изпревари на линка ти“ email (at most one a day). */
  beatenMails: boolean;
  /** What this player wants pushed to their devices (null: never set up); see PUSH. */
  push: PushPrefs | null;
  /** Others may play against your recorded matches (a recording plays when nobody's there for a Дуел). */
  shareRuns: boolean;
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
  /** Category mastery earned (MASTERY_TIERS), for the titles it unlocks. */
  mastery: CategoryMastery[];
  /** „Моят алманах“: facts collected, and how many missed questions „Поправителен“ has ready (`due`). */
  almanac: { facts: number; due: number };
  /** Groups the player is in. */
  groups: number;
  /** Won the evening Роял in the last day: its title is theirs to wear. */
  eveningChampion: boolean;
  /** Rewards picked at the level milestones (choiceKey), and the milestones reached and not yet decided. */
  chosen: string[];
  choices: PendingChoice[];
}

/** A level milestone reached and not yet decided: its own two (`options`), or one left at an earlier milestone. */
export interface PendingChoice {
  level: number;
  options: UnlockRef[];
  earlier: UnlockRef[];
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
  /** A bot's favourite categories: it knows them better, and picks one when it can. */
  strong?: CategoryId[];
  /**
   * A real player's match, played back: `name` is theirs, its answers come as they gave them (records.ts). Not a person
   * in this match (userId is null), and no bot either.
   */
  record?: { playedAt: number };
  /** Their best category mastery, for the intro („Майстор · История“). */
  mastery?: CategoryMastery;
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
  /**
   * Four options to pick from (two in a host's true-or-false); none on a number question (`number` says what to type
   * in) or an order question (`order` has the things to put in order).
   */
  kind: 'choice' | 'number' | 'order';
  options: string[];
  number: NumberInput | null;
  /** „Подреди“: the four things, in the order they're shown, and which way to order them. */
  order: { items: string[]; direction: OrderDirection } | null;
  /** A picture the question is about. */
  image: QuestionImage | null;
  /** The match's last question, its final (a number, when the bank has one). */
  final: boolean;
  /** Its points count this many times over: a number final NUMBER.finalTimes; any other question 1. */
  times: number;
  /** Username of the player who wrote it, for community questions. */
  author: string | null;
  durationMs: number;
  remainingMs: number;
  /** The reading window (readingMs): the speed bonus starts to drain after it. */
  /**
   * The clock the speed bonus drains over: `durationMs`, except in Соло at 30 s (half of it, the usual clock); null
   * without a clock (no speed bonus).
   */
  speedMs: number | null;
  readMs: number;
  /** Someone gets knocked out after this question. */
  elimination: boolean;
  /** Ids of players who already locked in (for reconnects). */
  answered: string[];
  /** Only when a (re)connecting client is brought up to speed: where you stand on this question. */
  mine?: {
    choice: number | null;
    /** The number you gave, on a number question. */
    guess: number | null;
    /** Your order, on an order question (the shown items' indices, first to last). */
    order?: number[] | null;
    removed: number[];
    doubled: boolean;
    retryArmed: boolean;
    retryPrompt: boolean;
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
  /**
   * On a number question: the number given (null: none in time) and how close it was, 0–1 (`correct` once it's at
   * least NUMBER.rightFrom).
   */
  number?: { guess: number | null; closeness: number };
  /** On an order question: the order given (null: none in time) and how many items are in their right place. */
  order?: { given: number[] | null; right: number };
}

export interface RevealPayload {
  index: number;
  /** The right option; −1 on a number or order question (`answerNumber` or `answerOrder` has the answer). */
  correct: number;
  answerNumber?: number;
  /**
   * The right order (the shown items' indices, first to last), each shown item's value and what the values count (none:
   * a host's own question that has none to show).
   */
  answerOrder?: { order: number[]; values: number[] | null; unit: string };
  /** Whose the question's picture is: with the answer, never before. */
  credit?: ImageCredit | null;
  /** The next question's picture, to fetch now so it's there when the question opens. */
  nextImage?: Pick<QuestionImage, 'src' | 'srcSet'> | null;
  results: Record<string, PlayerResult>;
  standings: Standing[];
  eliminated: string[];
  nextInMs: number;
  /** "Знаеше ли?" behind this question's answer, if it has one: sent with the reveal, never before (it could give the
   * answer away). */
  fact: string | null;
  /** How everyone who played this question before answered it, once enough have (null until then). */
  crowd: Crowd | null;
}

/** How a question's players answered it, over all matches (CROWD.minAnswers or more). */
export interface Crowd {
  /** Share who got it right, 0–1: „62% знаят“. */
  known: number;
  /**
   * Share who picked each option, in this match's order; no answer in time is the rest. Null on a number or order
   * question (`known`: close enough, or all in order).
   */
  picks: number[] | null;
  answers: number;
}

export const CROWD = {
  /** Answers a question needs before its shares are shown: fewer say more about who played than about the question. */
  minAnswers: 30,
} as const;

// ─── Web push ────────────────────────────────────────────────────────────────

/** What can be pushed, each switched on or off by the player (the daily reminder has its time instead). */
export const PUSH_KINDS = [
  { id: 'streak', label: 'Серията в опасност', hint: 'Вечерта, ако серията ти ще прекъсне в полунощ' },
  { id: 'duels', label: 'Твой ред в дуел', hint: 'Приятел те предизвика или чака да изиграеш реванша' },
  { id: 'records', label: 'Записите на мачовете ти', hint: 'Как се е справил записът ти срещу други (сутрин)' },
  { id: 'evening', label: 'Вечерен Роял', hint: 'Малко преди да започне' },
  { id: 'groups', label: 'Седмицата в групите', hint: 'В неделя, последният ден от седмицата' },
] as const;

export type PushKind = (typeof PUSH_KINDS)[number]['id'];

export interface PushPrefs {
  /** The daily reminder: minutes after midnight, Sofia time (null: none). */
  daily: number | null;
  kinds: Record<PushKind, boolean>;
}

/** At most this many a day, and none at night (Sofia time): a game that wakes you up gets switched off. */
export const PUSH = {
  perDay: 2,
  quietFrom: 22,
  quietUntil: 9,
  /** The daily reminder's choices: every half hour the quiet hours allow. */
  dailyFrom: 9 * 60,
  dailyTo: 21 * 60 + 30,
  dailyStep: 30,
} as const;

export const defaultPushPrefs = (): PushPrefs => ({
  daily: null,
  kinds: { streak: true, duels: true, records: true, evening: false, groups: true },
});

/**
 * Соло's clock: the usual 15 s; 30 s (the speed bonus still counts against the usual clock, so a record can't be
 * bought with time; an answer past 15 s doesn't count for skill and mastery); or none (base points, each answer waits
 * for „Продължи“) — to read and think at leisure, as practice.
 */
/**
 * How long a run alone waits on a hold (Game.ts): one the player asked for („Спри, за да прочета“, „Пауза“) goes on by
 * itself after `pauseMs`; in Соло without a clock every answer waits up to `untimedMs`. `warnMs` before the end, the
 * page says the run is about to go on.
 */
export const HOLD = { pauseMs: 2 * 60_000, untimedMs: 10 * 60_000, warnMs: 20_000 } as const;

export const SOLO_PACES = [
  { id: 'normal', label: '15 с', hint: 'С бонус за бързина' },
  {
    id: 'relaxed',
    label: '30 с',
    hint: 'Двойно време. Бонусът за бързина и майсторството — както при 15 с: отговор след 15-ата секунда не се брои.',
  },
  {
    id: 'untimed',
    label: 'Без часовник',
    hint: 'За упражнение: всеки отговор чака „Продължи“. Не се брои за майсторство, задачи и постижения, а верните носят половин XP.',
  },
] as const;

export type SoloPace = (typeof SOLO_PACES)[number]['id'];

export const isSoloPace = (v: unknown): v is SoloPace => SOLO_PACES.some((p) => p.id === v);

export interface GameStartPayload {
  gameId: string;
  mode: ModeId;
  /** Соло's clock (SOLO_PACES); every other mode plays 'normal'. */
  pace: SoloPace;
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
  /** A match played in rounds (ROUNDS): each one's category as far as it's known. Empty otherwise. */
  rounds: RoundInfo[];
  /** A friend duel: who it's against, and their score when they've played it already (the score to beat). */
  duelWith: { username: string; score: number | null } | null;
  /**
   * You're the room's host running it on a big screen („Само водя“), not a player: `youId` is nobody, and the screen
   * shows the question, how everyone answered and the top of the standings.
   */
  presenter?: boolean;
  /** A room playing its host's own set: its name (the questions have no category or difficulty of the bank's). */
  questionSet?: string | null;
  /** The next question's picture (the first's, at the start), to fetch during the countdown. */
  nextImage?: Pick<QuestionImage, 'src' | 'srcSet'> | null;
  /** Countdown before the first question (0 when re-syncing mid-game). */
  startsInMs: number;
}

export interface RoundInfo {
  /** Its first question (0-based) and how many it has. */
  from: number;
  size: number;
  /** Null until it's picked. */
  category: CategoryId | null;
  /** Who picked it; null for a draw (the first round, or a pick nobody made in time). */
  pickedBy: string | null;
}

/** Before a round: who picks its category, from which. */
export interface PickPayload {
  /** The round (an index into `rounds`). */
  round: number;
  pickerId: string;
  options: CategoryId[];
  durationMs: number;
  remainingMs: number;
}

/** A round's category is decided; its first question follows in `startsInMs`. */
export interface RoundPayload {
  round: number;
  category: CategoryId;
  pickedBy: string | null;
  startsInMs: number;
  /** The round's first question's picture, to fetch now (the reveal before the pick couldn't know it). */
  nextImage?: Pick<QuestionImage, 'src' | 'srcSet'> | null;
}

export interface PowerupEvent {
  playerId: string;
  powerup: PowerupId;
  /** 50/50: options removed (sent only to the user). */
  removed?: number[];
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
  daily: {
    /** Place among today's board; off the board, where the run would stand on it ("щеше да си 7-и от 24"). */
    rank: number;
    /** How many are on today's board. */
    total: number;
    /** A guest's run, or an account's made today: the same questions, kept off the board (see the server's trust.ts). */
    offBoard: boolean;
    streak: number;
    shieldsUsed: number;
    shieldEarned: boolean;
    /** Played from someone's daily link: their result, to compare with. */
    sharer: DailySharer | null;
    /** How the day went for everyone, once enough have played. */
    field: DailyField | null;
  } | null;
  /** A challenge-link run: where it placed among everyone who played that link; a friend duel's, how it stands. */
  challenge: { id: string; rank: number; total: number; duel: DuelStanding | null } | null;
  /** A solo run: the best solo score before this one (0 before the first), the record "Гони рекорда си" is about. */
  soloBest: number | null;
  /** „Моят алманах“: facts this match added, and how many there are now. */
  almanac: { added: number; total: number };
  /** Category mastery tiers this match earned. */
  mastery: CategoryMastery[];
}

/** How a day's questions went for everyone on the board (once DAILY_FIELD.minPlayers have played). */
export interface DailyField {
  /** Share of the others on the board this run did better than, 0–1: „По-добър от 73% днес“. */
  beaten: number;
  /** Runs on the board by right answers: [none right, one right, … all right]. */
  histogram: number[];
}

/**
 * `minPlayers`: the day's runs it takes to show how everyone did. `placeFrom`: to say a place at all — „#1 от 1“ is no
 * place, whatever the score.
 */
export const DAILY_FIELD = { minPlayers: 20, placeFrom: 5 } as const;

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
  /** Who's waiting with you (your partner in Отбори). */
  with?: string[];
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
  /** „Заключи стаята“: nobody new comes in by the code; they knock, and the host lets each in or not. */
  locked: boolean;
  /** Who's at the locked room's door, in the order they came: for the host only (empty for everyone else). */
  knocking: { id: string; name: string; isGuest: boolean }[];
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

/** `room`: come into my room (`roomCode`); `duo`: play Отбори with me (we queue as a pair). */
export interface Invite {
  id: string;
  from: PublicUser;
  roomCode: string | null;
  kind: 'room' | 'duo';
  expiresAt: number;
}

/** What a host changes in a room: the settings as they are, but their own set by its id (null: the bank). */
export type RoomSettingsPatch = Partial<Omit<RoomSettings, 'set'>> & { set?: number | null };

export type AckResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T extends object = object> = (res: AckResult<T>) => void;

export interface ServerToClientEvents {
  'lobby:stats': (s: LobbyStats) => void;
  'queue:status': (s: QueueStatus | null) => void;
  'room:state': (s: RoomState | null) => void;
  /** You knocked on a locked room's door, and aren't coming in: the host said no, it filled up or it closed. */
  'room:refused': (p: { code: string; message: string }) => void;
  'game:start': (p: GameStartPayload) => void;
  'game:question': (p: QuestionPayload) => void;
  'game:answered': (p: { playerId: string }) => void;
  'game:retry': (p: { wrong: number }) => void;
  /** An answer you sent wasn't taken (the client showed it as locked in). */
  'game:rejected': (p: { index: number; reason: AnswerRejection }) => void;
  'game:reveal': (p: RevealPayload) => void;
  /** A room's host paused the big screen on this reveal (the next question waits), or the pause ran out. */
  'game:paused': (p: { index: number; paused: boolean }) => void;
  /** A round's category is being picked (also re-sent to a client that reconnects meanwhile). */
  'game:pick': (p: PickPayload) => void;
  'game:round': (p: RoundPayload) => void;
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
  /** The evening Роял's lobby changed (someone came or went, it opened, it started): to those in it. */
  'evening:status': (p: EveningStatus) => void;
}

export interface ClientToServerEvents {
  'queue:join': (mode: QueueModeId, ack: Ack) => void;
  'queue:leave': () => void;
  'solo:start': (opts: { category: CategoryChoice; pace?: SoloPace }, ack: Ack) => void;
  /** `via`: the code of the daily link it was opened from (/daily/<code>). */
  'daily:start': (p: { via?: string }, ack: Ack) => void;
  /** Plays a challenge link (`id`), or creates a new one and plays it first (no `id`). */
  /**
   * Plays a challenge link (`id`), or creates one and plays it first (no `id`): open to anyone, or (`rival`) a duel for
   * one friend, who has a day to play it. `categories`: a rematch's three rounds, picked by whoever lost the last duel.
   */
  'challenge:start': (p: { id?: string; rival?: number; categories?: CategoryId[] }, ack: Ack<{ id: string }>) => void;
  /** „Поправителен“: the missed questions that are due (REVIEW). */
  'review:start': (ack: Ack) => void;
  /** The evening Роял's lobby: in (while it's open), or out. */
  'evening:join': (ack: Ack) => void;
  'evening:leave': () => void;
  'rematch:request': (p: { gameId: string }) => void;
  'rematch:decline': (p: { gameId: string }) => void;
  'room:create': (settings: RoomSettingsPatch, ack: Ack<{ code: string }>) => void;
  /**
   * `nickname`: what a guest goes by in the room (a guest has to give one). `waiting`: the room is locked, and you're at
   * its door until the host lets you in (the room's state comes) or not (`room:refused`).
   */
  'room:join': (p: string | { code: string; nickname?: string }, ack: Ack<{ code: string; waiting?: boolean }>) => void;
  'room:leave': () => void;
  'room:settings': (settings: RoomSettingsPatch) => void;
  'room:bot': (action: 'add' | 'remove') => void;
  'room:kick': (playerId: string) => void;
  /** The host locks the room (nobody new comes in by the code: they knock) or opens it (whoever knocked comes in). */
  'room:lock': (locked: boolean) => void;
  /** The host lets someone at the locked room's door in, or doesn't. */
  'room:admit': (p: { playerId: string; admit: boolean }, ack: Ack) => void;
  /** The host gives a guest's seat a plain „Играч N“ instead of the name the guest typed. */
  'room:rename': (playerId: string) => void;
  'room:team': (playerId: string) => void;
  'room:start': (ack: Ack) => void;
  'invite:send': (p: { userId: number }, ack: Ack) => void;
  /** Отбори with a friend: ask them, or (as the one asked) say yes — the two then wait in the queue as a pair. */
  'duo:invite': (p: { userId: number }, ack: Ack) => void;
  'duo:accept': (p: { inviteId: string }, ack: Ack) => void;
  'invite:decline': (p: { inviteId: string }) => void;
  'game:answer': (p: { index: number; choice: number }) => void;
  /** Your order on an order question: the shown items' indices, first to last. */
  'game:order': (p: { index: number; order: number[] }) => void;
  /** The number given on a number question. */
  'game:guess': (p: { index: number; value: number }) => void;
  /** The next round's category, from the ones offered (only whoever was asked to pick). */
  'game:pick': (p: { round: number; category: CategoryId }) => void;
  'game:powerup': (p: { index: number; powerup: PowerupId }) => void;
  'game:react': (emote: string) => void;
  'game:leave': () => void;
  /** A run played alone: stop on this question's fact, to read it. The next question waits for game:resume. */
  'game:hold': (p: { index: number }, ack: Ack) => void;
  'game:resume': () => void;
  /** A room's host, on the big screen: hold the next question on this reveal, or bring it on now. */
  'game:steer': (p: { index: number; action: 'pause' | 'next' }, ack: Ack) => void;
}

// ─── REST ────────────────────────────────────────────────────────────────────

export type Friendship = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';

export interface ProfileStats {
  user: PublicUser & { createdAt: number };
  friendship: Friendship;
  /** The viewer blocked this player (no friend requests either way, until unblocked). */
  blocked: boolean;
  /** Your friend duels with them (null when you've had none, or it's your own profile). */
  duels: DuelRecord | null;
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
  /** `tier`: the category mastery earned there (null: none yet). */
  categories: { category: CategoryId; answered: number; correct: number; tier: number | null }[];
  /** „Моят алманах“: facts collected, of how many there are. */
  almanac: { facts: number; total: number };
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

/** Who shared a daily link, and how they did that day. */
export interface DailySharer {
  user: Pick<PublicUser, 'username' | 'avatar' | 'frame'>;
  score: number;
  correct: number;
}

export interface DailyInfo {
  day: string;
  /** №1 is the first day (dayNumber). */
  number: number;
  endsAt: number;
  streak: number;
  /** Started today but not finished (a dropped attempt counts). */
  attempted: boolean;
  /**
   * Today's run is off the board: a guest's, or an account's made today (one made only to read the answers off for
   * another would have been). The questions are everyone's.
   */
  offBoard: boolean;
  /** Off the board, `rank` is where the run would stand on it. */
  played: { score: number; correct: number; rank: number; field: DailyField | null } | null;
  total: number;
  entries: LeaderboardEntry[];
  /** Today's results of you and your friends, ranked among yourselves (empty for a guest, who has no friends here). */
  friends: LeaderboardEntry[];
  /** Who played today's questions from your link, best first. */
  fromMyLink: { user: PublicUser; score: number; correct: number }[];
}

/** A daily link (/daily/<code>) as a visitor sees it, signed in or not. */
export interface DailyPreview {
  day: string;
  number: number;
  /** Null for /daily itself, or a link that isn't today's. */
  sharer: DailySharer | null;
  /** On today's board so far. */
  players: number;
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
  /** Where the answer can be checked (an https page): what a moderator checks it against. */
  answerSource?: string;
  /** A „Знаеше ли?“ for it, with where it can be checked. */
  fact?: string;
  factSource?: string;
}

export interface Submission extends QuestionDraft {
  id: number;
  status: SubmissionStatus;
  reason: string | null;
  createdAt: number;
  reviewedAt: number | null;
  author: PublicUser;
  /** An approved one's id in the game (a moderator corrects it there). */
  questionId: string | null;
  /** An approved one, as played so far: how many answered it and how many got it right. */
  played: { answered: number; correct: number } | null;
}

/** A question in the game that looks like a proposed one (for the moderator: a duplicate, or one it gives away). */
export interface SimilarQuestion {
  id: string;
  q: string;
  answer: string;
}

export const SUBMISSION_RULES = {
  minLevel: 3,
  /** Waiting at once: a few until a first one is approved, more after; one at a time after many rejected. */
  maxPending: 10,
  maxPendingNew: 3,
  maxPendingRejected: 1,
  rejectedLimit: 5,
  question: [10, 150],
  option: [1, 45],
  fact: [20, 200],
  /** XP the author gets when a question is approved. */
  approvedXp: 100,
} as const;

export const REPORT_REASONS = [
  { id: 'name', label: 'Обидно или неподходящо име' },
  { id: 'behavior', label: 'Обидно поведение' },
  { id: 'cheating', label: 'Измама или нечестна игра' },
  { id: 'content', label: 'Обидно или неподходящо съдържание' },
  { id: 'illegal', label: 'Незаконно съдържание' },
  { id: 'other', label: 'Друго' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

/** What a report is about: a player, a group (its name) or a shared set (its questions and pictures). */
export type ReportSubjectKind = 'player' | 'group' | 'set';

/** The reasons a report about each kind of thing can give. */
export const REPORT_REASONS_FOR: Record<ReportSubjectKind, readonly ReportReason[]> = {
  player: ['name', 'behavior', 'cheating', 'illegal', 'other'],
  group: ['name', 'illegal', 'other'],
  set: ['content', 'illegal', 'other'],
};

/** Who sent a report, as far as it helps to weigh it: how long they've played, and how their reports went before. */
export interface Reporter {
  id: number;
  name: string;
  days: number;
  matches: number;
  /** Their earlier reports a moderator acted on, and ones that found nothing. */
  upheld: number;
  dismissed: number;
}

/**
 * A case: every open report about one thing (a player, a group, a set), decided as one. `id`: the player's or the
 * group's id, or the set's code.
 */
export interface ReportCase {
  kind: ReportSubjectKind;
  id: string;
  /** The player, or whose the group or the set is. */
  owner: PublicUser & { bannedUntil: number | null };
  /** A group's or a set's name (null for a player). */
  name: string | null;
  /** A group's members, a set's questions. */
  size: number | null;
  /** A set a moderator already hid. */
  hidden: boolean;
  reports: { id: number; reason: ReportReason; details: string | null; createdAt: number; reporter: Reporter | null }[];
}

/** The queue: the cases most in need first (illegal content, then the most reported, then the oldest), a page of them. */
export interface ReportCases {
  cases: ReportCase[];
  /** All open cases, of which `cases` are the first. */
  total: number;
}

/** What a ban or a forced rename rests on: the rules in the Terms (§3), named to the player with the reason. */
export const MODERATION_BASES = [
  { id: 'abuse', label: 'Обиди, тормоз или заплахи' },
  { id: 'name', label: 'Неподходящо име' },
  { id: 'content', label: 'Неподходящо или незаконно съдържание' },
  { id: 'cheating', label: 'Нечестна игра: програми, втори профили, грешки в играта' },
  { id: 'spam', label: 'Спам' },
  { id: 'other', label: 'Друго нарушение на условията' },
] as const;

export type ModerationBasis = (typeof MODERATION_BASES)[number]['id'];

export const MODERATION = {
  /** A reason a player is told is at least this long: „нарушение“ alone tells them nothing. */
  reasonMin: 10,
  reasonMax: 300,
  /**
   * Flags on a question from this many players hide it until checked: players who were shown it, whose accounts rate
   * others (RATED_AFTER: a day old, ten matches), and whose flags on it a moderator never dismissed.
   */
  autoHideFlags: 3,
  /** At most this many questions a day are hidden by flags alone; past it, the flags still alert the moderators. */
  autoHidesPerDay: 5,
  /** This many open reports or flags about one player or question bring a moderator an email at once. */
  alertAt: 3,
  /** The moderators' morning summary (Sofia time). */
  digestHour: 9,
} as const;

export type ModerationAction =
  | { action: 'dismiss' }
  | { action: 'rename'; username: string; basis: ModerationBasis; reason: string }
  | { action: 'ban'; days: number | null; basis: ModerationBasis; reason: string; annul?: boolean };

/** A case's decision: about a player (as ModerationAction), a group's name, or a set. */
export type CaseDecision =
  | ModerationAction
  | { action: 'rename_group'; basis: ModerationBasis; reason: string }
  | { action: 'hide_set'; basis: ModerationBasis; reason: string; copies?: boolean };

/** What the moderation log keeps (each with what undoing it takes, when it can be undone). */
export type ModerationLogAction =
  | 'ban'
  | 'unban'
  | 'ban_change'
  | 'rename'
  | 'annul'
  | 'dismiss_reports'
  | 'hide_question'
  | 'auto_hide_question'
  | 'unhide_question'
  | 'fix_question'
  | 'dismiss_flags'
  | 'edit_question'
  | 'approve'
  | 'reject'
  | 'hide_set'
  | 'unhide_set'
  | 'rename_group'
  | 'reload_bank'
  | 'staff_add'
  | 'staff_remove'
  | 'staff_2fa_reset'
  | 'staff_sign_in'
  | 'second_factor_failed'
  | 'second_factor_locked'
  | 'stop_reports';

export interface ModerationLogEntry {
  id: number;
  action: ModerationLogAction;
  /** Who did it; null: the game itself (a question hidden by its players' flags). */
  admin: string | null;
  /** The player it was about, and/or what (a question's id, a set's or group's name), with where to see it. */
  user: PublicUser | null;
  target: string | null;
  link: string | null;
  basis: ModerationBasis | null;
  reason: string | null;
  createdAt: number;
  undoneAt: number | null;
  undoneBy: string | null;
  /** Why it was undone. */
  undoReason: string | null;
  /** It can be undone (not yet undone, and the action keeps what that takes). */
  canUndo: boolean;
}

/** A staff member's second factor this session: an authenticator app to set up, a code to give, or given. */
export type SecondFactorState = 'setup' | 'needed' | 'ok';

/** What waits for the moderators (the home card, the tabs' counts), and their second factor this session. */
export interface AdminSummary {
  pendingQuestions: number;
  openReports: number;
  questionReports: number;
  secondFactor: SecondFactorState;
}

/** A player as a moderator sees them (the „Играчи“ tab). */
export interface PlayerCard {
  user: PublicUser & { isGuest: boolean; createdAt: number; lastSeenAt: number | null; hasEmail: boolean };
  /** Staff: decisions about them are the owner's. */
  staff: 'owner' | 'moderator' | null;
  /** A deleted account with this verified e-mail was banned (in the last 12 months): the same person starting over. */
  bannedBefore: { basis: ModerationBasis | null; until: number | null; erasedAt: number } | null;
  ban: { until: number; basis: ModerationBasis | null; reason: string | null } | null;
  gamesPlayed: number;
  reports: { open: number; resolved: number; filed: number };
  submissions: { pending: number; approved: number; rejected: number };
  /** Groups they made and sets they share: what a report about them is often about. */
  groups: { id: number; name: string; members: number }[];
  sets: { code: string; name: string; hidden: boolean }[];
  log: ModerationLogEntry[];
}

export interface PlayerSearchHit {
  user: PublicUser;
  isGuest: boolean;
  banned: boolean;
  createdAt: number;
}

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
  /** None on a number or order question (and `answer` is −1: `number` or `order` has its answer). */
  options: string[];
  answer: number;
  number: { answer: number; unit: string } | null;
  /** An order question's items in their right order. */
  order: RightOrder | null;
  /** Its picture, with whose it is. */
  image: (QuestionImage & ImageCredit) | null;
  /** Username of a community question's author. */
  author: string | null;
  /** Hidden from new matches by a moderator. */
  hidden: boolean;
  /** Its "Знаеше ли?" and where that can be checked (moderators judge reports about it). */
  fact: string | null;
  factSource: string | null;
  /** Where its answer is checked (a player's question, and a bank question that has one). */
  answerSource: string | null;
}

/** Open reports about one question, for the moderation queue. */
export interface QuestionReportGroup {
  question: QuestionInfo;
  reports: { id: number; reason: QuestionReportReason; details: string; createdAt: number; reporter: string | null }[];
}

/** `fixed`: corrected (its numbers start over, and whoever flagged it is thanked). */
export type QuestionReportAction = 'dismiss' | 'hide' | 'fixed';

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
  /** The best finished runs (up to 50), best first, and the viewer's own after them if it's further down. */
  entries: ChallengeEntry[];
  /** How many finished runs there are in all. */
  total: number;
  /** You started it (one attempt each). */
  attempted: boolean;
  expired: boolean;
  /** A friend duel: only its two may play it. */
  duelOnly: boolean;
  /** …and how it stands for the viewer, if they're one of them. */
  duel: (DuelStanding & { creatorId: number | null }) | null;
}

/** Two friends' duels so far: from one side. */
export interface DuelRecord {
  wins: number;
  losses: number;
  draws: number;
}

/** A friend duel as one of its two players sees it. */
export interface DuelStanding {
  friend: PublicUser;
  /** Each side's run, once played. */
  mine: { score: number; correct: number; timeMs: number } | null;
  theirs: { score: number; correct: number; timeMs: number } | null;
  /** Null until both have played (or it ran out). */
  outcome: 'won' | 'lost' | 'draw' | null;
  /** The two of them over all their duels. */
  record: DuelRecord;
  /** By when the second has to play it. */
  expiresAt: number;
  expired: boolean;
  /** Lost it: may pick the next one's categories (a rematch). */
  canPick: boolean;
}

/** A friend duel in a list (home, friends): whose turn it is, or how it ended. */
export interface DuelEntry extends DuelStanding {
  id: string;
  createdAt: number;
  /** yours: waiting for you; theirs: for them; done: both played; expired: ran out unplayed. */
  state: 'yours' | 'theirs' | 'done' | 'expired';
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
  /** The network every connection to the site passes through first (Cloudflare's proxy), if there is one. */
  proxy: string | null;
  /** Where the off-site backups are kept, when that's not the hosting provider. */
  backups: string | null;
  /** Forwards mail sent to the contact address, if a service does. */
  inbox: string | null;
  /** Where mail to the contact address ends up (the mailbox the forwarder delivers to). */
  mailbox: string | null;
  /** Where this site's source code is published (offered in the footer, as the AGPL asks of hosted copies). */
  sourceUrl: string | null;
  /** The commit this server runs (the source offer links that exact version). */
  release: string | null;
  /** Questions in play, rounded down to the hundred ("над 1 900 въпроса"). */
  questions: number;
  /** The year in the footer's ©: the server's, as it drew its pages (a browser's own could be a year on, and differ). */
  year: number;
  /** Error reports go to a provider (Sentry), and web push is on: the privacy policy names them only then. */
  monitoring: boolean;
  push: boolean;
}

// ─── „Моят алманах“ ──────────────────────────────────────────────────────────

/** One fact in a player's almanac: the question it's behind, its answer, and when it became theirs. */
export interface AlmanacFact {
  id: string;
  category: CategoryId;
  q: string;
  /** The right option; null on a number or order question (`number` or `order` has the answer). */
  answer: string | null;
  number: (Pick<NumberInput, 'unit' | 'step' | 'scale'> & { answer: number }) | null;
  /** An order question's items in their right order, with what each is ordered by. */
  order: RightOrder | null;
  /** The question's picture (a small one: the almanac is a list). */
  image: QuestionImage | null;
  fact: string;
  learnedAt: number;
}

/** An order question's answer, as reviews and the almanac show it: the items first to last, with their numbers. */
export interface RightOrder {
  items: { text: string; value: number }[];
  unit: string;
}

/** „Поправителен“: the missed questions coming back, and when. */
export interface ReviewQueue {
  /** Ready to play now. */
  due: number;
  /** Not due yet. */
  waiting: number;
  /** When the next one not due yet is (null: none waiting). */
  nextDueAt: number | null;
  /** A run needs this many due (REVIEW.min): fewer wait for more. */
  ready: boolean;
}

export interface AlmanacOverview {
  facts: number;
  /** Facts there are to collect. */
  total: number;
  categories: { category: CategoryId; facts: number; total: number; tier: number | null }[];
  review: ReviewQueue;
  /** The newest few, newest first. */
  recent: AlmanacFact[];
}

export interface AlmanacCategoryPage {
  category: CategoryId;
  facts: AlmanacFact[];
  total: number;
  tier: number | null;
}

/**
 * „Поправителен“: a missed question comes back `afterDays[0]` days later, then (right) `afterDays[1]`, then
 * `afterDays[2]`; right then too, it's learned for good. Wrong at any step, it starts over; nearly right (a number
 * `nearCloseness` close, an order with `nearPlaced` items in place) is that step again. A run plays up to `size` of
 * those due, once at least `min` are. At most `keep` are coming back at a time — a pile of hundreds is a debt, not
 * practice (almanac.ts → makeRoom) — and a near miss outside a run never enters.
 */
export const REVIEW = {
  afterDays: [3, 7, 21],
  size: 10,
  min: 3,
  keep: 30,
  nearCloseness: 0.5,
  nearPlaced: 2,
} as const;

// ─── Groups ──────────────────────────────────────────────────────────────────

/**
 * A class, an office, a family: a group with an invite link and a weekly board of „Въпросите на деня“ (Monday to
 * Sunday, Sofia time): each member's best `bestDays` daily scores that week, summed. Last week's winner wears a 👑.
 */
export const GROUPS = { maxMembers: 200, perPlayer: 5, bestDays: 5, name: [2, 30] } as const;

/** A group as its member's home card and list show it. */
export interface GroupSummary {
  id: number;
  name: string;
  members: number;
  /** This week's board: your place (null: no daily played yet this week), and who leads with how much. */
  you: { rank: number; score: number } | null;
  leader: { username: string; score: number; you: boolean } | null;
  /** You won last week. */
  crown: boolean;
}

export interface GroupEntry {
  rank: number;
  user: PublicUser;
  score: number;
  /** Dailies played this week (the best GROUPS.bestDays count). */
  days: number;
  /** Today's score, if they've played it. */
  today: number | null;
  /** Won last week. */
  crown: boolean;
}

export interface GroupInfo {
  id: number;
  name: string;
  /** The invite code (/groups/join/<code>). */
  code: string;
  owner: PublicUser | null;
  isOwner: boolean;
  members: number;
  /** This week: who has played (best first), then everyone who hasn't yet. */
  week: { start: string; endsAt: number; entries: GroupEntry[]; waiting: PublicUser[] };
  /** Past weeks' winners, newest first. */
  history: { week: string; winner: PublicUser | null; score: number }[];
}

/** An invite link as anyone who opens it sees it. */
export interface GroupPreview {
  name: string;
  members: number;
  owner: string | null;
  /** The viewer is in it already (its id, to go there). */
  memberOf: number | null;
  full: boolean;
}

// ─── „Моите въпроси“: a host's own question sets ─────────────────────────────

/** A host's own picture in a question of theirs: uploaded first (POST /api/sets/images), then saved with the set. */
export interface SetImage {
  /** What the upload answered with: a hash of the picture. */
  id: string;
  w: number;
  h: number;
  /** What's in it, for players who can't see it (without the answer). */
  alt: string;
  /** Where to see it for now (a signed address the server gives with the set; never kept with it). */
  url?: string;
}

/** Where a set's picture is served (an id is 16 hex digits; encoded all the same, as anything put in an address). */
export const setPictureUrl = (id: string) => `/api/sets/images/${encodeURIComponent(id)}`;

/** One question of a host's own set: four options, true or false (either with a picture), a number, or an order. */
export type SetQuestion =
  | { kind: 'choice'; q: string; options: string[]; answer: number; image?: SetImage }
  | { kind: 'truefalse'; q: string; answer: boolean; image?: SetImage }
  | {
      kind: 'number';
      q: string;
      /** The answer; `unit` after it („км“, „г.“); `tolerance`: how far off still scores (a guess that far scores 0). */
      number: { answer: number; unit: string; tolerance: number };
    }
  | {
      kind: 'order';
      q: string;
      /**
       * The four, first to last. A `value` (a year, a height) for each shows with the answer; given for all, they must
       * go up or down in this order.
       */
      items: { text: string; value: number | null }[];
      unit: string;
    };

export const SETS = {
  /** Questions in one set, and sets per host. */
  maxQuestions: 50,
  perOwner: 30,
  name: [2, 40],
  question: [5, 200],
  option: [1, 60],
  unit: 12,
  /** Pictures one host keeps (in all their sets), how big a side may be, and what one may weigh. */
  images: 200,
  imageSide: 1200,
  imageBytes: 150_000,
  imageAlt: 150,
} as const;

/** A set as its owner keeps and edits it. */
export interface QuestionSetInfo {
  id: number;
  name: string;
  /** Its share link (/sets/shared/<code>): other hosts take a copy for their rooms. */
  code: string;
  questions: SetQuestion[];
  /** A moderator hid it (a report about it held up): it can't be played or shared. */
  hidden: boolean;
  updatedAt: number;
}

export interface QuestionSetSummary {
  id: number;
  name: string;
  questions: number;
  hidden: boolean;
  updatedAt: number;
}

/** A shared set as another host sees it before taking a copy. */
export interface SharedSetPreview {
  name: string;
  author: string | null;
  questions: number;
  /** The kinds in it, for the preview: „12 с избор, 3 вярно/невярно, 2 с число, 1 за подреждане“. */
  kinds: { choice: number; truefalse: number; number: number; order: number };
  /** The viewer's own set (they can edit it rather than copy it). */
  mine: number | null;
  /** Hidden by a moderator (only its owner and moderators still see it). */
  hidden: boolean;
}

// ─── „Вечерен Роял“ ──────────────────────────────────────────────────────────

/** Tonight's evening Роял (EVENING): when its lobby opens, when it starts, who's waiting. */
export interface EveningStatus {
  /** The day it's for (a day key), and when it starts and its lobby opens. */
  day: string;
  startsAt: number;
  opensAt: number;
  /** In the lobby now (between opensAt and startsAt). */
  waiting: number;
  /** You're in the lobby. */
  joined: boolean;
  /** Its matches are being played now. */
  live: boolean;
}

/** An evening that's been played: its top (EVENING.top), and how many played. */
export interface EveningNight {
  day: string;
  players: number;
  top: { placement: number; user: PublicUser; score: number }[];
}

export interface EveningInfo {
  /** Null when there's no evening Роял on this server. */
  status: EveningStatus | null;
  lastNight: EveningNight | null;
}
