import { randomUUID } from 'node:crypto';
import {
  type AnswerRejection,
  answerPoints,
  type CategoryChoice,
  type CategoryId,
  type Crowd,
  closeness,
  type Difficulty,
  EVENING,
  eliminationSchedule,
  type FinalStanding,
  type GameEndPayload,
  type GamePlayer,
  type GameStartPayload,
  IMAGE,
  isOrder,
  knockoutsAfter,
  type MatchRewards,
  type ModeId,
  NUMBER,
  numberPoints,
  ORDER,
  orderPoints,
  ordinal,
  type PickPayload,
  type PlayerResult,
  POWERUPS,
  type PowerupId,
  placedRight,
  type QuestionPayload,
  ROUNDS,
  type RoundInfo,
  readingMs,
  SCORING,
  type ServerToClientEvents,
  type SoloPace,
  START_RATING,
  type Standing,
  snapNumber,
  type TeamId,
  teamPoints,
} from '@quiz/shared';
import { config } from '../config';
import { reportError } from '../monitoring';
import {
  bankOption,
  bankOrder,
  imageCredit,
  isChoice,
  type NumberQuestion,
  type OrderQuestion,
  orderOf,
  type PreparedQuestion,
  questionAuthor,
  questionImage,
  type RoundPlan,
  shuffle,
} from '../questions';
import { expectedRight, questionRating } from '../skill';
import { type BotBrain, FAVOURITE_LEAN } from './bots';

const COUNTDOWN_MS = 3_500;
/** Accept answers that were in flight when the clock hit zero. */
const GRACE_MS = 400;
/** Pause between the last answer arriving and the reveal. */
const EARLY_REVEAL_MS = 600;
const REVEAL_MS = 4_000;
/** The longest a room host's „Пауза“ holds the next question: a big screen left paused doesn't keep the room forever. */
const HOST_PAUSE_MS = 10 * 60_000;
const ELIMINATION_EXTRA_MS = 2_000;
/** A round's category, picked: on screen this long before its first question. */
const ROUND_CARD_MS = 2_000;
/** How long a bot takes to pick a round's category, at least, plus up to as much again. */
const BOT_PICK_MS = 1_200;
/** If every human has been disconnected this long, the rest of the match plays out without them. */
const ABANDON_MS = 30_000;
/**
 * A run played alone (solo, the daily, a challenge link) has nobody waiting on it: it waits this long for its player to
 * come back before it ends with what was played.
 */
const ALONE_ABANDON_MS = 10 * 60_000;
/** A run that waited for its player goes on this long after they're back, so the next question doesn't ambush them. */
const RESUME_MS = 2_500;
/** A run alone can stop on a fact to read it; it goes on by itself after this long. */
const FACT_HOLD_MS = 2 * 60_000;
/** Соло without a clock still ends a question someone walked away from: after this long it's revealed. */
const UNTIMED_MS = 10 * 60_000;
/** A dropped connection (a page refresh, a tunnel) is waited for this long before the question can close without them. */
const DISCONNECT_GRACE_MS = 5_000;
const REACTION_COOLDOWN_MS = 700;
/** A match the other side walks out of before this many questions were played counts for nobody who stayed. */
const NO_CONTEST_QUESTIONS = 3;

/**
 * The clock for durations in a match (how long a question has been open, a reconnect's grace, a reaction's cooldown):
 * monotonic, so the server's wall clock being set right mid-question can't hand out or take away time. Tests that mock
 * `Date` point it there.
 */
export const gameClock = { now: () => performance.now() };

type Events = ServerToClientEvents;
type Args<E extends keyof Events> = Parameters<Events[E]>;

export interface GameEmitter {
  toGame<E extends keyof Events>(event: E, ...args: Args<E>): void;
  toUser<E extends keyof Events>(userId: number, event: E, ...args: Args<E>): void;
  toGameExcept<E extends keyof Events>(userId: number, event: E, ...args: Args<E>): void;
}

export interface GameHooks {
  /** Persist results; returns per-user rewards. */
  finalize(game: Game, standings: FinalStanding[]): Map<number, MatchRewards>;
  /**
   * A one-attempt run ended without a result (cut short by us, or saving failed): the attempt is the player's again if
   * nothing was revealed, else it stands with the score saved by progress().
   */
  release(game: Game): void;
  /** A one-attempt run is about to reveal an answer: its score so far is what stands if it's cut short from here on. */
  progress(game: Game): void;
  /** The server is about to stop: a run waiting for an absent player shouldn't hold it up. */
  draining(): boolean;
  /** How everyone who played a question before answered it (for its reveal), once enough have. */
  crowd(q: PreparedQuestion): Crowd | null;
  /** A picked round's questions: now its players have seen them (the start only knew the others). */
  shown(game: Game, questionIds: string[]): void;
  /** The match ended while this player was offline: they get the result when they're back. */
  undelivered(userId: number, start: GameStartPayload, end: GameEndPayload): void;
  onClosed(game: Game): void;
}

export interface GameSetup {
  mode: ModeId;
  ranked: boolean;
  roomCode: string | null;
  hostUserId: number | null;
  timeMs: number;
  category: CategoryChoice;
  elimination: boolean;
  teams: boolean;
  /** Calendar day of a daily-challenge run. */
  dailyDay: string | null;
  /** The challenge link this run is for. */
  challengeId: string | null;
  /** With ROUNDS, a later round's place holds its first offer until it's picked. */
  questions: PreparedQuestion[];
  /** A match in ROUNDS (Дуел); empty otherwise. */
  rounds: RoundPlan[];
  humans: { player: GamePlayer; powerups: PowerupId[]; emotes: string[] }[];
  bots: { player: GamePlayer; brain: BotBrain }[];
  /** Real players' matches, played back (records.ts): their answers as they gave them, and whose they are. */
  records?: { player: GamePlayer; script: RecordScript; runId: number; ownerId: number }[];
  /** A friend duel: who it's against (and their score, if they've played it). */
  duelWith?: GameStartPayload['duelWith'];
  /** A room's host who runs it on a big screen („Само водя“): hears the match, plays no part in it. */
  presenter?: number | null;
  /** A room playing its host's own set (its name): none of the bank's questions. */
  questionSet?: string | null;
  /** The evening Роял of this day (its places are kept for the night's top and the champion). */
  eveningDay?: string | null;
  /** Соло's clock (SOLO_PACES): 'normal' unless the player chose otherwise. */
  pace?: SoloPace;
  /**
   * How many times over a number final counts: NUMBER.finalTimes, unless the set was made before it did (a day's
   * questions, a link: everyone who plays the same questions plays them by the same rules).
   */
  finalTimes?: number;
}

/**
 * The day (Sofia) the final began to count NUMBER.finalTimes over: a day's questions, a link or a friend duel made
 * before it keep it single. (Done with once no such set is open: a week on.)
 */
export const FINAL_TIMES_FROM = '2026-10-31';

/** A recorded answer to each of a match's questions (null: none in time), in the match's own option order. */
export type RecordScript = (RecordedAnswer | null)[];

export interface RecordedAnswer {
  /** The option picked (as shown in this match), the number given, or the order (of the items as shown here). */
  choice?: number;
  value?: number;
  order?: number[];
  timeMs: number;
  powerup: PowerupId | null;
  /** Right on "Втори шанс"'s second try. */
  retried: boolean;
}

export interface Participant {
  player: GamePlayer;
  brain: BotBrain | null;
  /** A recording's answers, when this is one. */
  script: RecordScript | null;
  powerups: PowerupId[];
  usedPowerups: Set<PowerupId>;
  emotes: Set<string>;
  score: number;
  correct: number;
  /** Questions this player was still in the match for. */
  faced: number;
  /** Of those, the ones they picked an answer on (someone who never does is no rival to beat in a private room). */
  answered: number;
  /** A person's answer to each question they faced, in order (the answer log). */
  log: AnswerLogEntry[];
  streak: number;
  bestStreak: number;
  fastestCorrectMs: number | null;
  /** The fastest right answer to a medium or hard question (an easy one can be guessed before it's read). */
  fastestHardCorrectMs: number | null;
  correctMs: number;
  answerMs: number;
  correctByDifficulty: Record<Difficulty, number>;
  categories: Map<CategoryId, { answered: number; correct: number; correctMs: number }>;
  eliminatedAt: number | null;
  /** Walked out. Once knocked out that's no forfeit: the place they were knocked out at stands. */
  left: boolean;
  /** Order of leaving (1 = first): whoever walked out first ranks last. */
  leftOrder: number | null;
  connected: boolean;
  disconnectedAt: number | null;
  /** Was strictly last at the halfway point (for the comeback achievement). */
  lastAtHalfway: boolean;
  lastReactionAt: number;
  // Per-question state, reset by nextQuestion():
  /**
   * `value`: the number given on a number question; `order`: the order given on an order question (the shown items'
   * indices, first to last). `choice` is −1 on both.
   */
  answer: { choice: number; value?: number; order?: number[]; timeMs: number; retried: boolean } | null;
  doubled: boolean;
  removed: number[];
  powerupThisQuestion: boolean;
  /** Which коз that was (for the answer log). */
  powerupNow: PowerupId | null;
  retryArmed: boolean;
  firstWrong: number | null;
  /** A bot's mind for this question, made up when it opened (scheduleBots); null when it zones out. */
  move: BotMove | null;
}

export interface AnswerLogEntry {
  questionId: string;
  /** Its place in the match (0 = the first question). */
  index: number;
  category: CategoryId;
  difficulty: Difficulty;
  /** The option picked, as the bank orders them (not as shown): null for no answer in time, or a number question. */
  choice: number | null;
  /** On a number question: the number given (null: none in time), and how close it was (0–1). */
  guess: number | null;
  closeness: number | null;
  /**
   * On an order question: the order given, as the bank orders the items (null: none in time, or the question changed),
   * and how many items were in their right place.
   */
  arranged: number[] | null;
  placed: number | null;
  /** A number counts as right once it's close (NUMBER.rightFrom); an order once all of it is right. */
  correct: boolean;
  /** Null: no answer in time. */
  timeMs: number | null;
  /** What the answer scored (negative: a lost "Двойно или нищо"). */
  points: number;
  /** The коз played on this question, if one was. */
  powerup: PowerupId | null;
  /** Right on "Втори шанс"'s second try (half the points). */
  retried: boolean;
  /**
   * Given after the usual clock (Соло's longer paces): time enough to look the answer up, so it says nothing about what
   * the player knows (rewards.ts → measured).
   */
  slow: boolean;
  /**
   * Given after being knocked out („Играй до края“): it says what the player knows and pays XP, but scores nothing and
   * stays out of the match's tallies (rewards.ts → knowledgeOf).
   */
  out: boolean;
}

interface BotMove {
  knows: boolean;
  afterMs: number;
  joker: PowerupId | null;
  /** Its number, on a number question. */
  guess: number | null;
  /** Its order, on an order question. */
  order: number[] | null;
}

/** `pick`: before a round, while its category is picked and shown. */
type Phase = 'countdown' | 'question' | 'reveal' | 'pick' | 'ended';

const BOT_EMOTES = { good: ['fire', 'cool', 'thumbs'], bad: ['lol', 'wow', 'dead'] };
/** The козове bots play: the two about their own answer, a person's typical pair. */
const BOT_JOKERS: readonly PowerupId[] = ['fifty', 'double'];

export class Game {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  readonly participants = new Map<string, Participant>();
  readonly schedule: number[];
  /** The match's questions (a round's are in place once it's picked). */
  readonly questions: PreparedQuestion[];
  /** In a match in ROUNDS: each round's category, as far as it's decided. */
  readonly rounds: RoundInfo[];
  phase: Phase = 'countdown';
  index = -1;
  /** Questions played to the reveal. */
  played = 0;
  /** Ended before the last question because only one side was left in it. */
  endedByWalkout = false;
  /** Ended by us, not by the game: the server stopping, or a bug in this match. */
  cutShort = false;
  /** Nobody else in it (solo, the daily, a challenge link): no one is waiting on its player. */
  readonly alone: boolean;
  /** Соло's clock; every other mode plays the usual one. */
  get pace(): SoloPace {
    return this.setup.mode === 'solo' ? (this.setup.pace ?? 'normal') : 'normal';
  }

  /** At the match's last question, its final. „Поправителен“ has none: just the questions coming back. */
  private get atFinal(): boolean {
    return this.index === this.questions.length - 1 && this.questions.length > 1 && this.setup.mode !== 'review';
  }

  /** How many times over the open question's points count: a number final's NUMBER.finalTimes (finalTimes). */
  private get times(): number {
    return this.atFinal && this.questions[this.index]?.kind === 'number'
      ? (this.setup.finalTimes ?? NUMBER.finalTimes)
      : 1;
  }

  /** A run played alone, paused before its next question until its player is back. */
  held = false;
  /** A run played alone whose player stopped on the fact (each stop gets a number, so an old timer can't end a new one). */
  private reading = 0;
  private readingSeq = 0;
  /** A room's host paused the big screen on a reveal (numbered as `reading` is): the next question waits for them. */
  private paused = 0;
  private pauseSeq = 0;
  /** The reveal ended while they were reading (or the host had paused): the next question comes when they go on. */
  private waitingForReader = false;
  /** The reveal's own wait for the next question, which the host's „Следващ“ cuts short. */
  private revealTimer: NodeJS.Timeout | null = null;

  private questionStartedAt = 0;
  /** The open question's clock: the match's, or a number's (longer: it's typed in). */
  private limitMs = 0;
  /**
   * The clock the speed bonus (and the time kept in stats) counts against: the usual one, even when Соло's pace gives
   * more (`limitMs`), so more time never buys more points and slow answers don't skew the averages.
   */
  private scoreLimitMs = 0;
  /** The open question's reading window (readingMs): its speed bonus drains only after it. */
  private readMs = 0;
  /** A round's category being picked: by whom, from what, since when. */
  private picking: { round: number; pickerId: string; options: CategoryId[]; startedAt: number } | null = null;
  private timers = new Set<NodeJS.Timeout>();
  private questionTimer: NodeJS.Timeout | null = null;
  private abandonTimer: NodeJS.Timeout | null = null;
  private leaves = 0;
  /** Playing the rest out at once with nobody watching: nothing goes out to the match's room. */
  private quiet = false;

  constructor(
    readonly setup: GameSetup,
    private emit: GameEmitter,
    private hooks: GameHooks,
  ) {
    const solo = setup.humans.length + setup.bots.length === 1;
    this.questions = [...setup.questions];
    this.rounds = setup.rounds.map((r) => ({ from: r.from, size: r.size, category: r.category, pickedBy: null }));
    for (const h of setup.humans)
      this.participants.set(h.player.id, this.newParticipant(h.player, null, h.powerups, h.emotes));
    for (const b of setup.bots)
      this.participants.set(b.player.id, this.newParticipant(b.player, b.brain, [...BOT_JOKERS], []));
    for (const r of setup.records ?? []) {
      const p = this.newParticipant(
        r.player,
        null,
        POWERUPS.map((d) => d.id),
        [],
      );
      p.script = r.script;
      this.participants.set(r.player.id, p);
    }
    this.alone = solo;
    // The questions after which someone goes out: the evening Роял's checkpoints, or one at a time spread to the end.
    this.schedule =
      setup.mode === 'evening'
        ? [...EVENING.cuts.map((c) => c.after), EVENING.finalTwoAfter]
        : setup.elimination && !setup.teams
          ? eliminationSchedule(this.participants.size, setup.questions.length)
          : [];
  }

  get humans() {
    return [...this.participants.values()].filter((p) => p.player.userId !== null);
  }

  playerIdFor(userId: number) {
    return `u${userId}`;
  }

  start() {
    for (const p of this.humans)
      this.emit.toUser(p.player.userId!, 'game:start', this.startPayload(p.player.id, COUNTDOWN_MS));
    if (this.setup.presenter) this.emit.toUser(this.setup.presenter, 'game:start', this.presenterStart(COUNTDOWN_MS));
    this.later(COUNTDOWN_MS, () => this.advance());
  }

  // ─── Player actions ──────────────────────────────────────────────────────
  // Those that move the match along run in guard(): a bug in one ends the match cleanly instead of leaving it stuck.

  answer(playerId: string, index: number, choice: number) {
    this.guard(() => {
      const p = this.participants.get(playerId);
      if (!p || !this.mayAnswer(p) || p.answer || this.phase === 'ended') return;
      // The client drew the pick as locked in: say why it wasn't taken, so it can unlock it and tell the player.
      const reject = (reason: AnswerRejection) => {
        if (p.player.userId !== null) this.emit.toUser(p.player.userId, 'game:rejected', { index, reason });
      };
      if (this.phase !== 'question' || index !== this.index) return reject('late');
      const q = this.questions[this.index];
      if (!isChoice(q) || !Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
      if (p.removed.includes(choice)) return reject('removed');
      const limit = this.limitMs;
      const elapsed = this.elapsed();
      if (elapsed > limit + GRACE_MS) return reject('late');

      if (p.retryArmed && p.firstWrong === null && choice !== q.answer) {
        // "Втори шанс": the first miss isn't final.
        p.firstWrong = choice;
        p.removed = [...p.removed, choice];
        this.emit.toUser(p.player.userId!, 'game:retry', { wrong: choice });
        return;
      }
      p.answer = { choice, timeMs: Math.min(elapsed, limit), retried: p.firstWrong !== null };
      this.answered(p);
      this.maybeRevealEarly();
    });
  }

  /** The number given on a number question (brought into its range, in whole steps). */
  guess(playerId: string, index: number, value: number) {
    this.guard(() => {
      const p = this.participants.get(playerId);
      if (!p || !this.mayAnswer(p) || p.answer || this.phase === 'ended') return;
      const reject = (reason: AnswerRejection) => {
        if (p.player.userId !== null) this.emit.toUser(p.player.userId, 'game:rejected', { index, reason });
      };
      if (this.phase !== 'question' || index !== this.index) return reject('late');
      const q = this.questions[this.index];
      if (q.kind !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) return;
      const elapsed = this.elapsed();
      if (elapsed > this.limitMs + GRACE_MS) return reject('late');
      p.answer = {
        choice: -1,
        value: snapNumber(value, q.number),
        timeMs: Math.min(elapsed, this.limitMs),
        retried: false,
      };
      this.answered(p);
      this.maybeRevealEarly();
    });
  }

  /** The order given on an order question: the shown items' indices, first to last. */
  arrange(playerId: string, index: number, order: unknown) {
    this.guard(() => {
      const p = this.participants.get(playerId);
      if (!p || !this.mayAnswer(p) || p.answer || this.phase === 'ended') return;
      const reject = (reason: AnswerRejection) => {
        if (p.player.userId !== null) this.emit.toUser(p.player.userId, 'game:rejected', { index, reason });
      };
      if (this.phase !== 'question' || index !== this.index) return reject('late');
      const q = this.questions[this.index];
      if (q.kind !== 'order' || !isOrder(order, q.items.length)) return;
      const elapsed = this.elapsed();
      if (elapsed > this.limitMs + GRACE_MS) return reject('late');
      p.answer = { choice: -1, order: [...order], timeMs: Math.min(elapsed, this.limitMs), retried: false };
      this.answered(p);
      this.maybeRevealEarly();
    });
  }

  /** The next round's category, from the ones on offer: only whoever was asked to pick, while they're asked. */
  pick(playerId: string, round: number, category: CategoryId) {
    this.guard(() => {
      const picking = this.picking;
      if (!picking || picking.round !== round || picking.pickerId !== playerId) return;
      if (!picking.options.includes(category)) return;
      this.decideRound(category, playerId);
    });
  }

  usePowerup(playerId: string, index: number, powerup: PowerupId) {
    this.guard(() => {
      const p = this.participants.get(playerId);
      if (!p || this.phase !== 'question' || index !== this.index || !this.isActive(p) || p.answer) return;
      if (!p.powerups.includes(powerup) || p.usedPowerups.has(powerup) || p.powerupThisQuestion) return;
      const userId = p.player.userId!;
      const q = this.questions[this.index];
      // A number or an order has no options to take away and no wrong pick to retry (and the final is played bare).
      // With only two options (true or false, in a host's own set), 50/50 or a second try would give the answer away.
      if (!isChoice(q)) return;
      if ((powerup === 'fifty' || powerup === 'retry') && q.options.length < 4) return;
      if (q.difficulty === 'easy' && POWERUPS.find((d) => d.id === powerup)?.notOnEasy) return;

      this.consume(p, powerup);
      switch (powerup) {
        case 'fifty': {
          // A recording keeps the option it went on to pick (whatever it was): its answer is already given.
          const kept = p.script?.[this.index]?.choice;
          p.removed = shuffle(
            q.options.map((_, i) => i).filter((i) => i !== q.answer && i !== kept && !p.removed.includes(i)),
          ).slice(0, 2);
          // A bot (or a recording) has nobody to tell which ones went; the others only see that it was played.
          if (p.player.userId === null) this.toGame('game:powerup', { playerId, powerup });
          else {
            this.emit.toUser(userId, 'game:powerup', { playerId, powerup, removed: p.removed });
            this.emit.toGameExcept(userId, 'game:powerup', { playerId, powerup });
          }
          break;
        }
        case 'double':
          p.doubled = true;
          this.toGame('game:powerup', { playerId, powerup });
          break;
        case 'retry':
          p.retryArmed = true;
          this.toGame('game:powerup', { playerId, powerup });
          break;
      }
    });
  }

  /**
   * "Спри, за да прочета": in a run played alone, the player stops on the question's fact to read it (in Соло, on any
   * reveal: „Пауза“). Only during the reveal of the question on screen (nobody else is waiting); the next question then
   * waits for resume(), or FACT_HOLD_MS.
   */
  hold(playerId: string, index: number): boolean {
    // Not while the server drains: stopping on fact after fact would keep the run going until it's cut short.
    if (this.hooks.draining()) return false;
    if (!this.alone || this.phase !== 'reveal' || index !== this.index || this.reading) return false;
    if (!this.participants.has(playerId)) return false;
    if (this.setup.mode !== 'solo' && !this.questions[this.index]?.fact) return false;
    const seq = ++this.readingSeq;
    this.reading = seq;
    this.later(FACT_HOLD_MS, () => this.resume(playerId, seq));
    return true;
  }

  /**
   * A class's pace, from the host's big screen: „Пауза“ on a reveal holds the next question while the teacher talks the
   * answer through (HOST_PAUSE_MS at most); „Следващ“ brings it on now, paused or not. Everyone sees the pause.
   */
  steer(userId: number, index: number, action: 'pause' | 'next'): boolean {
    if (userId !== this.setup.presenter || this.phase !== 'reveal' || index !== this.index) return false;
    if (action === 'pause') {
      // Not while the server drains: a pause would hold the match until it's cut short.
      if (this.paused || this.hooks.draining()) return false;
      const seq = ++this.pauseSeq;
      this.paused = seq;
      this.later(HOST_PAUSE_MS, () => this.unpause(seq));
      this.toGame('game:paused', { index, paused: true });
      return true;
    }
    this.guard(() => {
      this.paused = 0;
      this.waitingForReader = false;
      if (this.revealTimer) clearTimeout(this.revealTimer);
      this.revealTimer = null;
      this.advance();
    });
    return true;
  }

  /** The host's pause runs out (or the server drains): on as if „Следващ“ had come when the reveal ended. */
  private unpause(seq = this.paused) {
    if (!this.paused || seq !== this.paused) return;
    this.paused = 0;
    this.toGame('game:paused', { index: this.index, paused: false });
    if (!this.waitingForReader || this.reading) return;
    this.waitingForReader = false;
    this.advance();
  }

  /** On with the run after a fact (or after FACT_HOLD_MS: `seq` says which stop the timer was for). */
  resume(playerId: string, seq = this.reading) {
    this.guard(() => {
      if (!this.reading || seq !== this.reading || !this.participants.has(playerId)) return;
      this.reading = 0;
      if (!this.waitingForReader) return;
      this.waitingForReader = false;
      this.advance();
    });
  }

  react(playerId: string, emote: string) {
    const p = this.participants.get(playerId);
    if (!p || this.phase === 'ended' || !p.emotes.has(emote)) return;
    const now = gameClock.now();
    if (now - p.lastReactionAt < REACTION_COOLDOWN_MS) return;
    p.lastReactionAt = now;
    this.toGame('game:reaction', { playerId, emote });
  }

  leave(playerId: string) {
    this.guard(() => {
      const p = this.participants.get(playerId);
      if (!p || p.left || this.phase === 'ended') return;
      p.left = true;
      p.leftOrder = ++this.leaves;
      p.connected = false;
      this.toGame('game:presence', { playerId, connected: false, left: true });
      if (this.decided()) this.endedByWalkout = true;
      if (this.humans.every((h) => h.left) || this.decided()) return this.end();
      this.maybeRevealEarly();
      this.checkAbandoned();
    });
  }

  setConnected(playerId: string, connected: boolean) {
    this.guard(() => {
      const p = this.participants.get(playerId);
      if (!p || p.left || p.connected === connected || this.phase === 'ended') return;
      p.connected = connected;
      p.disconnectedAt = connected ? null : gameClock.now();
      // Someone who dropped isn't reading: the disconnect hold takes over (and a fresh tab knows nothing of the stop).
      if (!connected && this.reading) {
        this.reading = 0;
        if (this.waitingForReader) {
          this.waitingForReader = false;
          this.advance();
        }
      }
      this.toGame('game:presence', { playerId, connected, left: false });
      if (connected && this.abandonTimer) {
        clearTimeout(this.abandonTimer);
        this.abandonTimer = null;
      }
      if (connected && this.held) {
        this.held = false;
        this.later(RESUME_MS, () => this.advance());
      }
      if (!connected) {
        this.later(DISCONNECT_GRACE_MS + 50, () => this.maybeRevealEarly());
        this.checkAbandoned();
      }
    });
  }

  /**
   * Payloads that bring a (re)connecting client up to speed, including where this player stands on the open question
   * (their pick or number, козове) or the round being picked: a fresh tab has none of it.
   */
  syncFor(playerId: string): { start: GameStartPayload; question: QuestionPayload | null; pick: PickPayload | null } {
    const p = this.participants.get(playerId)!;
    return {
      start: this.startPayload(playerId, 0),
      question:
        this.phase === 'question'
          ? {
              ...this.questionPayload(),
              mine: {
                choice: p.answer && p.answer.choice >= 0 ? p.answer.choice : null,
                guess: p.answer?.value ?? null,
                order: p.answer?.order ?? null,
                removed: p.removed,
                doubled: p.doubled,
                retryArmed: p.retryArmed,
                retryPrompt: p.firstWrong !== null && !p.answer,
                powerupThisQuestion: p.powerupThisQuestion,
              },
            }
          : null,
      pick: this.pickPayload(),
    };
  }

  /** What brings the big screen of a host who runs the match (and dropped) up to speed. */
  syncPresenter(): { start: GameStartPayload; question: QuestionPayload | null; pick: PickPayload | null } {
    return {
      start: this.presenterStart(0),
      question: this.phase === 'question' ? this.questionPayload() : null,
      pick: this.pickPayload(),
    };
  }

  /** The start as the host's big screen sees it: everyone in the match, and none of it theirs. */
  private presenterStart(startsInMs: number): GameStartPayload {
    return {
      ...this.startPayload(null, startsInMs),
      presenter: true,
    };
  }

  /**
   * The server is about to stop while this run waits for its absent player. Before its first question it was no
   * attempt (stop: theirs again). Once questions have been shown it ends as it would after ALONE_ABANDON_MS, with what
   * was played: giving it back would let anyone close the tab when an update is announced and replay the same ten
   * questions, knowing some answers. Someone actually playing isn't held: the drain waits for them.
   */
  endForDrain(): void {
    if (this.index < 0) {
      this.stop();
      return;
    }
    this.guard(() => this.finishUnattended());
  }

  /**
   * The server starts draining: a run held for its absent player ends now, and one stopped on a fact (or a class paused
   * by its host) goes on.
   */
  drain() {
    if (this.held) return this.endForDrain();
    if (this.paused) return this.guard(() => this.unpause());
    if (!this.reading) return;
    this.reading = 0;
    if (!this.waitingForReader) return;
    this.waitingForReader = false;
    this.guard(() => this.advance());
  }

  /**
   * The server is stopping and can't wait any longer: the match ends here, and the scores so far count (unrated: we cut
   * it, not the players). A daily or challenge-link run ends with what was played once a question was shown (giving it
   * back would mean a replay knowing answers); before that it was no attempt, and the player gets it back.
   */
  stop(): void {
    if (this.index >= 0 && (this.setup.dailyDay || this.setup.challengeId)) {
      this.endForDrain();
      return;
    }
    this.cutShort = true;
    this.guard(() => this.end());
  }

  // ─── Flow ────────────────────────────────────────────────────────────────

  /**
   * On to the next question, unless nobody is left to play it. A run played alone waits for its player (a locked phone
   * or a tunnel shouldn't cost the day's one attempt); and once every person in a match is knocked out, the bots' final
   * is decided at once rather than keeping the knocked-out waiting minutes for their result.
   */
  private advance() {
    if (this.reading || this.paused) {
      this.waitingForReader = true;
      return;
    }
    if (this.alone && !this.humans[0]?.connected) {
      if (this.hooks.draining()) return this.endForDrain();
      this.held = true;
      return;
    }
    if (this.participants.size > 1 && !this.humans.some((h) => this.isActive(h))) return this.finishUnattended(true);
    const round = this.roundDue();
    if (round !== null) return this.startPick(round);
    this.nextQuestion();
  }

  private nextQuestion() {
    this.index++;
    if (this.index >= this.questions.length) return this.end();
    this.phase = 'question';
    this.questionStartedAt = gameClock.now();
    const q = this.questions[this.index];
    const image = questionImage(q);
    // A number or an order takes longer to give than a tap; a picture is quicker to know than a question to read
    // (in a room, though, the host's clock is everyone's).
    this.scoreLimitMs =
      q.kind === 'number'
        ? Math.max(NUMBER.timeMs, this.setup.timeMs)
        : q.kind === 'order'
          ? Math.max(ORDER.timeMs, this.setup.timeMs)
          : image && !this.setup.roomCode
            ? Math.min(IMAGE.timeMs, this.setup.timeMs)
            : this.setup.timeMs;
    this.limitMs =
      this.pace === 'relaxed' ? this.scoreLimitMs * 2 : this.pace === 'untimed' ? UNTIMED_MS : this.scoreLimitMs;
    this.readMs =
      readingMs(q.q, isChoice(q) ? q.options : q.kind === 'order' ? q.items.map((i) => i.text) : []) +
      (image ? IMAGE.readExtraMs : 0);
    for (const p of this.participants.values()) {
      p.answer = null;
      p.doubled = false;
      p.removed = [];
      p.powerupThisQuestion = false;
      p.powerupNow = null;
      p.retryArmed = false;
      p.firstWrong = null;
      p.move = null;
    }
    this.toGame('game:question', this.questionPayload());
    this.scheduleBots();
    this.questionTimer = this.later(this.limitMs + GRACE_MS, () => this.reveal());
  }

  // ─── Rounds ──────────────────────────────────────────────────────────────

  /** The round the next question opens, when its category is still to be picked. */
  private roundDue(): number | null {
    const round = this.rounds.findIndex((r) => r.from === this.index + 1 && r.category === null);
    return round < 0 ? null : round;
  }

  /**
   * Before a round: whoever is behind picks its category from the ones on offer, within ROUNDS.pickMs (a bot picks its
   * strongest); otherwise one is drawn.
   */
  private startPick(round: number) {
    this.phase = 'pick';
    const picker = this.trailing();
    const options = this.setup.rounds[round].offers.map((o) => o.category);
    this.picking = { round, pickerId: picker.player.id, options, startedAt: gameClock.now() };
    this.toGame('game:pick', this.pickPayload()!);
    if (picker.brain) {
      const brain = picker.brain;
      const lean = (c: CategoryId) => (brain.strong.includes(c) ? 0 : brain.weak.includes(c) ? 2 : 1);
      const [favourite] = shuffle(options).sort((a, b) => lean(a) - lean(b));
      this.later(BOT_PICK_MS * (1 + Math.random()), () => this.pick(picker.player.id, round, favourite));
    }
    this.later(ROUNDS.pickMs + GRACE_MS, () => this.decideRound(shuffle(options)[0], null));
  }

  /** Who picks the next round: whoever is behind on points; on a tie the lower-rated, then the one with fewer right. */
  private trailing(): Participant {
    const rating = (p: Participant) => p.player.rating ?? START_RATING;
    return [...this.participants.values()]
      .filter((p) => this.isActive(p))
      .sort((a, b) => a.score - b.score || rating(a) - rating(b) || a.correct - b.correct)[0];
  }

  /** The round being picked gets `category` (`by`: who picked it; null for a draw), and its questions come in. */
  private decideRound(category: CategoryId, by: string | null) {
    if (this.phase !== 'pick' || !this.picking) return;
    const { round } = this.picking;
    this.picking = null;
    this.clearTimers();
    this.settleRound(round, category, by);
    this.toGame('game:round', {
      round,
      category,
      pickedBy: by,
      startsInMs: ROUND_CARD_MS,
      nextImage: this.nextImage(),
    });
    this.later(ROUND_CARD_MS, () => this.advance());
  }

  /** Puts a round's category and its questions in place, and tells the registry they're now seen. */
  private settleRound(round: number, category: CategoryId, by: string | null) {
    const plan = this.setup.rounds[round];
    const offer = plan.offers.find((o) => o.category === category) ?? plan.offers[0];
    this.questions.splice(plan.from, plan.size, ...offer.questions);
    this.rounds[round] = { ...this.rounds[round], category: offer.category, pickedBy: by };
    try {
      this.hooks.shown(
        this,
        offer.questions.map((q) => q.id),
      );
    } catch (err) {
      void reportError(err, 'mark questions seen', { extra: { match: this.id } });
    }
  }

  /** The questions the match is sure to play: all but those of rounds still to be picked. */
  settledQuestions(): PreparedQuestion[] {
    return this.questions.filter(
      (_, i) => !this.rounds.some((r) => r.category === null && i >= r.from && i < r.from + r.size),
    );
  }

  private pickPayload(): PickPayload | null {
    if (this.phase !== 'pick' || !this.picking) return null;
    const { round, pickerId, options, startedAt } = this.picking;
    const elapsed = (gameClock.now() - startedAt) / config.gameTimeScale;
    return { round, pickerId, options, durationMs: ROUNDS.pickMs, remainingMs: Math.max(0, ROUNDS.pickMs - elapsed) };
  }

  private maybeRevealEarly() {
    if (this.phase !== 'question') return;
    const now = gameClock.now();
    const reconnecting = (p: Participant) =>
      p.disconnectedAt !== null && now - p.disconnectedAt < DISCONNECT_GRACE_MS * config.gameTimeScale;
    // Alone, the clock is the only limit: nobody else is waiting for the question to close.
    const undecided = [...this.participants.values()].filter(
      (p) => this.isActive(p) && !p.answer && (this.alone || p.connected || machine(p) || reconnecting(p)),
    );
    if (undecided.some((p) => !machine(p))) return;
    // Only bots left: they made up their minds when the question opened, so they answer now, with the time they took,
    // instead of keeping people waiting for a bot's clock (a duel against one took half again as long as a solo run).
    for (const p of undecided) this.botAnswerNow(p);
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = this.later(EARLY_REVEAL_MS, () => this.reveal());
  }

  private reveal() {
    if (this.phase !== 'question') return;
    this.phase = 'reveal';
    this.played++;
    this.clearTimers();

    const q = this.questions[this.index];
    const number = q.kind === 'number' ? q.number : null;
    const order = q.kind === 'order' ? orderOf(q) : null;
    const results: Record<string, PlayerResult> = {};
    for (const p of this.participants.values()) {
      if (!this.isActive(p)) {
        if (this.playsOn(p) && p.answer) results[p.player.id] = this.answeredOn(p, q);
        continue;
      }
      // A "Втори шанс" miss with no second pick stands as the answer.
      if (!p.answer && p.firstWrong !== null) p.answer = { choice: p.firstWrong, timeMs: this.limitMs, retried: false };
      p.faced++;
      if (p.answer) p.answered++;
      const cat = p.categories.get(q.category) ?? { answered: 0, correct: 0, correctMs: 0 };
      p.categories.set(q.category, cat);
      cat.answered++;

      const { guess, close, given, placed, correct } = this.judge(p, q);
      let points = 0;
      // Tie-breaks compare total time, so a question left unanswered costs the whole clock.
      p.answerMs += Math.min(p.answer?.timeMs ?? this.scoreLimitMs, this.scoreLimitMs);
      if (correct && p.answer) {
        const timeMs = Math.min(p.answer.timeMs, this.scoreLimitMs);
        p.streak++;
        p.correct++;
        p.correctByDifficulty[q.difficulty]++;
        cat.correct++;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        // A number is about how close, not how fast, and an order takes four taps: their time stays out of the fastest
        // and average right answers.
        if (!number && !order) {
          p.correctMs += timeMs;
          cat.correctMs += timeMs;
          p.fastestCorrectMs = p.fastestCorrectMs === null ? timeMs : Math.min(p.fastestCorrectMs, timeMs);
          if (q.difficulty !== 'easy') p.fastestHardCorrectMs = Math.min(p.fastestHardCorrectMs ?? timeMs, timeMs);
        }
      } else {
        p.streak = 0;
      }
      if (number) {
        // Closer scores more, right or not; no speed bonus, no streak bonus. As the final, twice that.
        points = guess === null ? 0 : numberPoints(guess, number) * this.times;
      } else if (order) {
        // Each item in its place scores, right or not; all of them also the speed and streak bonus.
        points = p.answer
          ? orderPoints({
              right: placed ?? 0,
              timeMs: p.answer.timeMs,
              limitMs: this.scoreLimitMs,
              readMs: this.readMs,
              streak: p.streak,
              untimed: this.pace === 'untimed',
            })
          : 0;
      } else if (correct && p.answer) {
        points = answerPoints({
          timeMs: p.answer.timeMs,
          limitMs: this.scoreLimitMs,
          readMs: this.readMs,
          streak: p.streak,
          doubled: p.doubled,
          retried: p.answer.retried,
          untimed: this.pace === 'untimed',
        });
      } else if (p.doubled && p.score > 0) {
        // "Двойно или нищо" is a bet: a miss costs points (never below zero).
        points = -Math.min(SCORING.doubleStake, p.score);
      }
      p.score += points;
      if (p.player.userId !== null)
        p.log.push({
          questionId: q.id,
          index: this.index,
          category: q.category,
          difficulty: q.difficulty,
          choice: isChoice(q) && p.answer ? bankOption(q, p.answer.choice) : null,
          guess,
          closeness: close,
          arranged: q.kind === 'order' && given ? bankOrder(q, given) : null,
          placed,
          correct,
          timeMs: p.answer ? Math.min(p.answer.timeMs, this.scoreLimitMs) : null,
          points,
          powerup: p.powerupNow,
          retried: !!p.answer?.retried && correct,
          slow: !!p.answer && p.answer.timeMs > this.scoreLimitMs,
          out: false,
        });
      results[p.player.id] = {
        choice: isChoice(q) ? (p.answer?.choice ?? null) : null,
        correct,
        points,
        timeMs: p.answer?.timeMs ?? null,
        streak: p.streak,
        doubled: p.doubled,
        retried: !!p.answer?.retried && correct,
        ...(close !== null && { number: { guess, closeness: close } }),
        ...(placed !== null && { order: { given, right: placed } }),
      };
    }

    const questionNo = this.index + 1;
    if (questionNo === Math.floor(this.questions.length / 2)) this.markHalfwayLast();

    const eliminated: string[] = [];
    const active = this.ranked().filter((p) => this.isActive(p));
    // The last of those still in (in the evening Роял, the bottom few): out.
    const out = knockoutsAfter(this.setup.mode, this.schedule, questionNo, active.length);
    for (const loser of active.slice(active.length - out)) {
      loser.eliminatedAt = questionNo;
      eliminated.push(loser.player.id);
    }

    // A one-attempt run keeps its score so far before the answer goes out: cut short from here on, that score stands.
    if (this.setup.dailyDay || this.setup.challengeId) {
      try {
        this.hooks.progress(this);
      } catch (err) {
        void reportError(err, 'save run progress', { extra: { match: this.id } });
      }
    }

    const nextInMs = REVEAL_MS + (eliminated.length ? ELIMINATION_EXTRA_MS : 0);
    this.toGame('game:reveal', {
      index: this.index,
      correct: isChoice(q) ? q.answer : -1,
      ...(number && { answerNumber: number.answer }),
      ...(q.kind === 'order' &&
        order && {
          answerOrder: { order, values: q.hideValues ? null : q.items.map((i) => i.value), unit: q.unit ?? '' },
        }),
      credit: imageCredit(q),
      nextImage: this.nextImage(),
      results,
      standings: this.standings(),
      eliminated,
      nextInMs,
      fact: q.fact ?? null,
      crowd: this.crowdOf(q),
    });
    this.botReactions(results);
    // Соло without a clock has no clock on its answers either: each one waits for „Продължи“ (a hold the player ends),
    // up to the untimed question's own limit, rather than moving on after a few seconds.
    if (this.pace === 'untimed' && this.alone && !this.hooks.draining()) {
      const player = this.humans[0];
      const seq = ++this.readingSeq;
      this.reading = seq;
      if (player) this.later(UNTIMED_MS, () => this.resume(player.player.id, seq));
    }
    this.revealTimer = this.later(nextInMs, () => this.advance());
  }

  /** How a player's answer to the open question came out: the number or order given, how close, and whether it's right. */
  private judge(p: Participant, q: PreparedQuestion) {
    const number = q.kind === 'number' ? q.number : null;
    const order = q.kind === 'order' ? orderOf(q) : null;
    const guess = number ? (p.answer?.value ?? null) : null;
    const close = number ? (guess === null ? 0 : closeness(guess, number)) : null;
    const given = order ? (p.answer?.order ?? null) : null;
    const placed = order ? placedRight(given, order) : null;
    const correct =
      q.kind === 'number'
        ? (close ?? 0) >= NUMBER.rightFrom
        : q.kind === 'order'
          ? placed === ORDER.items
          : p.answer?.choice === q.answer;
    return { guess, close, given, placed, correct };
  }

  /**
   * An answer from someone knocked out („Играй до края“): judged and logged like any (what they know, XP, the almanac),
   * for no points, and outside the match's tallies and streaks.
   */
  private answeredOn(p: Participant, q: PreparedQuestion): PlayerResult {
    const answer = p.answer!;
    const { guess, close, given, placed, correct } = this.judge(p, q);
    p.log.push({
      questionId: q.id,
      index: this.index,
      category: q.category,
      difficulty: q.difficulty,
      choice: isChoice(q) ? bankOption(q, answer.choice) : null,
      guess,
      closeness: close,
      arranged: q.kind === 'order' && given ? bankOrder(q, given) : null,
      placed,
      correct,
      timeMs: Math.min(answer.timeMs, this.scoreLimitMs),
      points: 0,
      powerup: null,
      retried: false,
      slow: answer.timeMs > this.scoreLimitMs,
      out: true,
    });
    return {
      choice: isChoice(q) ? answer.choice : null,
      correct,
      points: 0,
      timeMs: answer.timeMs,
      streak: 0,
      doubled: false,
      retried: false,
      ...(close !== null && { number: { guess, closeness: close } }),
      ...(placed !== null && { order: { given, right: placed } }),
    };
  }

  /** The next question's picture, to fetch while this one's answer is shown (unknown while its round isn't picked). */
  private nextImage(): { src: string; srcSet: string } | null {
    const next = this.index + 1;
    if (this.rounds.some((r) => r.category === null && next >= r.from && next < r.from + r.size)) return null;
    const q = this.questions[next];
    const image = q ? questionImage(q) : null;
    return image && { src: image.src, srcSet: image.srcSet };
  }

  /** The question's crowd shares, or none if they can't be had: a reveal never waits on them. */
  private crowdOf(q: PreparedQuestion): Crowd | null {
    try {
      return this.hooks.crowd(q);
    } catch (err) {
      void reportError(err, 'crowd shares', { extra: { match: this.id, question: q.id } });
      return null;
    }
  }

  private end() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimers();
    if (this.abandonTimer) clearTimeout(this.abandonTimer);

    // A one-attempt run we cut short has no fair result, and one left before its first question was no attempt: nothing
    // is saved and the attempt is the player's again.
    if ((this.cutShort || this.index < 0) && (this.setup.dailyDay || this.setup.challengeId)) {
      try {
        this.hooks.release(this);
      } catch (err) {
        void reportError(err, 'release attempt', { extra: { match: this.id } });
      }
      for (const p of this.humans) {
        if (p.left) continue;
        this.emit.toUser(p.player.userId!, 'game:aborted', {
          gameId: this.id,
          message: 'Мачът прекъсна при нас — опитът ти не е изгубен. Изиграй го отново след малко.',
        });
      }
      return this.hooks.onClosed(this);
    }

    const teamScores = this.setup.teams ? this.teamScores() : null;
    const standings = this.finalStandings(teamScores);
    let rewards = new Map<number, MatchRewards>();
    try {
      rewards = this.hooks.finalize(this, standings);
    } catch (err) {
      void reportError(err, 'match results', { extra: { match: this.id, mode: this.setup.mode } });
    }
    // `humans` leaves out anyone who deleted their account mid-match (finalize forgets their user id).
    for (const p of this.humans) {
      const userId = p.player.userId!;
      const mine = rewards.get(userId) ?? null;
      if (p.left) {
        // Knocked out, then off to something else: just say how it ended.
        const placement = standings.find((s) => s.id === p.player.id)?.placement;
        if (!this.forfeited(p) && mine && placement) {
          const message = `Мачът, от който излезе, приключи: ${ordinal(placement)} място, +${mine.xpGained} XP.`;
          this.emit.toUser(userId, 'notice', { kind: 'info', message });
        }
        continue;
      }
      const payload: GameEndPayload = {
        gameId: this.id,
        mode: this.setup.mode,
        ranked: this.setup.ranked,
        roomCode: this.setup.roomCode,
        standings,
        teamScores,
        rewards: mine,
        noContest: this.noContest,
      };
      this.emit.toUser(userId, 'game:end', payload);
      if (!p.connected) this.hooks.undelivered(userId, this.startPayload(p.player.id, 0), payload);
    }
    if (this.setup.presenter) {
      this.emit.toUser(this.setup.presenter, 'game:end', {
        gameId: this.id,
        mode: this.setup.mode,
        ranked: this.setup.ranked,
        roomCode: this.setup.roomCode,
        standings,
        teamScores,
        rewards: null,
        noContest: this.noContest,
      });
    }
    this.hooks.onClosed(this);
  }

  // ─── Teams ───────────────────────────────────────────────────────────────

  /**
   * Team totals (teamPoints: unequal sides by their average), winner first. A team that walked out loses; ties go to
   * more correct answers, then faster total time (per member).
   */
  teamScores(): { team: TeamId; score: number }[] {
    const all = [...this.participants.values()].filter((p) => p.player.team !== null);
    const points = teamPoints(all.map((p) => [p.player.team!, p.score] as const));
    const totals = ([0, 1] as TeamId[]).map((team) => {
      const members = all.filter((p) => p.player.team === team);
      const per = (n: number) => n / Math.max(1, members.length);
      return {
        team,
        gone: members.every((p) => p.left),
        score: points[team],
        correct: per(members.reduce((s, p) => s + p.correct, 0)),
        time: per(members.reduce((s, p) => s + p.answerMs, 0)),
      };
    });
    totals.sort(
      (a, b) => Number(a.gone) - Number(b.gone) || b.score - a.score || b.correct - a.correct || a.time - b.time,
    );
    return totals.map(({ team, score }) => ({ team, score }));
  }

  /** Individual games: rank order. Team games: winners share 1st place, everyone else (and leavers) 2nd. */
  private finalStandings(teamScores: { team: TeamId; score: number }[] | null): FinalStanding[] {
    const standings = this.standings();
    if (!teamScores) return standings.map((s, i) => ({ ...s, placement: i + 1 }));
    const winner = teamScores[0].team;
    return standings
      .map((s) => {
        const p = this.participants.get(s.id)!;
        return { ...s, placement: p.player.team === winner && !this.forfeited(p) ? 1 : 2 };
      })
      .sort((a, b) => a.placement - b.placement || a.rank - b.rank);
  }

  // ─── Bots ────────────────────────────────────────────────────────────────

  /**
   * How likely a bot is to get this question right: as likely as a person of its skill (expectedRight against the
   * question's measured rating), better in its strong categories and worse in its weak ones.
   */
  private knowChance(brain: BotBrain, q: PreparedQuestion): number {
    const lean = brain.strong.includes(q.category)
      ? FAVOURITE_LEAN
      : brain.weak.includes(q.category)
        ? -FAVOURITE_LEAN
        : 0;
    return clamp(expectedRight(brain.skill, questionRating(q.id, q.difficulty).rating) + lean, 0.05, 0.97);
  }

  /**
   * How a bot plays the current question: whether it knows the answer, how long it takes (game ms), and a joker it
   * plays on the way, as a person would — 50/50 when it doesn't know, "Двойно или нищо" mostly when it does (now and
   * then on a hunch, which costs it). On a number question, its number: the more it knows, the closer. Null when it
   * zones out.
   */
  private botMove(p: Participant): BotMove | null {
    const brain = p.brain!;
    const q = this.questions[this.index];
    if (Math.random() < 0.04) return null; // zoned out — lets the clock run down
    const chance = this.knowChance(brain, q);
    // With options, a person who doesn't know still guesses: a quarter of those come out right. So a bot knows a bit
    // less often than it's right (as often as such a person, in all) — and never less often than a random tap.
    const guessed = isChoice(q) ? 1 / q.options.length : 0;
    const knows = Math.random() < Math.max(0, (chance - guessed) / (1 - guessed));
    const fraction = clamp(brain.pace + (Math.random() - 0.5) * 0.35 + (knows ? -0.05 : 0.1), 0.08, 0.92);
    const afterMs = Math.max(900, fraction * this.limitMs);
    if (q.kind === 'number') return { knows, afterMs, joker: null, guess: this.botGuess(q, chance), order: null };
    if (q.kind === 'order') return { knows, afterMs, joker: null, guess: null, order: this.botOrder(q, knows, chance) };
    const playable = (id: PowerupId) =>
      p.powerups.includes(id) &&
      !p.usedPowerups.has(id) &&
      !(q.difficulty === 'easy' && POWERUPS.find((d) => d.id === id)?.notOnEasy);
    // 50/50 kept for a question past the easy ones, as a person would.
    const joker =
      !knows && playable('fifty') && q.difficulty !== 'easy' && q.options.length === 4 && Math.random() < 0.35
        ? 'fifty'
        : playable('double') && Math.random() < (knows ? 0.25 : 0.06)
          ? 'double'
          : null;
    return { knows, afterMs, joker, guess: null, order: null };
  }

  /**
   * A bot's number: off by a random amount (normally distributed) of up to about half the tolerance for a bot that
   * barely knows, a fifth for one that surely does — on a log scale, by a factor.
   */
  private botGuess(q: NumberQuestion, chance: number): number {
    const n = q.number;
    const spread = 0.55 - 0.35 * chance;
    const off = gaussian() * spread;
    const raw = n.scale === 'log' ? n.answer * n.tolerance ** off : n.answer + off * n.tolerance;
    return snapNumber(raw, n);
  }

  /**
   * A bot's order: the right one if it knows it; else the right one with neighbours swapped — once by a bot that nearly
   * knows, up to three times by one that barely does (a person who half-knows a chronology mixes up close ones).
   */
  private botOrder(q: OrderQuestion, knows: boolean, chance: number): number[] {
    const right = orderOf(q);
    if (knows) return right;
    const order = [...right];
    const swaps = chance > 0.5 ? 1 : chance > 0.25 ? 2 : 3;
    for (let n = 0; n < swaps || order.every((item, i) => item === right[i]); n++) {
      const i = Math.floor(Math.random() * (order.length - 1));
      [order[i], order[i + 1]] = [order[i + 1], order[i]];
    }
    return order;
  }

  /** A bot's pick: the answer if it knows it; else a guess among the options left (two, after 50/50). */
  private botChoice(p: Participant, knows: boolean): number {
    const q = this.questions[this.index];
    if (!isChoice(q)) return -1;
    if (knows) return q.answer;
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.answer && !p.removed.includes(i));
    const left = [q.answer, ...wrong];
    return left[Math.floor(Math.random() * left.length)];
  }

  /** A bot's answer as it made up its mind (botMove), with the time it took. */
  private botAnswer(p: Participant, move: BotMove): NonNullable<Participant['answer']> {
    return move.order !== null
      ? { choice: -1, order: move.order, timeMs: move.afterMs, retried: false }
      : move.guess !== null
        ? { choice: -1, value: move.guess, timeMs: move.afterMs, retried: false }
        : { choice: this.botChoice(p, move.knows), timeMs: move.afterMs, retried: false };
  }

  private scheduleBots() {
    const index = this.index;
    for (const p of this.participants.values()) {
      if (p.script && this.isActive(p)) this.scheduleRecorded(p, index);
      if (!p.brain || !this.isActive(p)) continue;
      const move = this.botMove(p);
      p.move = move;
      if (!move) continue;
      const { joker, guess, order } = move;
      if (joker) this.later(move.afterMs * 0.4, () => this.usePowerup(p.player.id, index, joker));
      this.later(move.afterMs, () =>
        order !== null
          ? this.arrange(p.player.id, index, order)
          : guess !== null
            ? this.guess(p.player.id, index, guess)
            : this.answer(p.player.id, index, this.botChoice(p, move.knows)),
      );
    }
  }

  /** A recording plays this question as its owner did: the коз a little before the answer, the answer when given. */
  private scheduleRecorded(p: Participant, index: number) {
    const recorded = p.script![index];
    if (!recorded) return;
    const { powerup } = recorded;
    if (powerup) this.later(recorded.timeMs * 0.4, () => this.usePowerup(p.player.id, index, powerup));
    this.later(recorded.timeMs, () => this.giveRecorded(p, index));
  }

  /** A recording's answer to the open question (its коз first, if it hadn't come yet), with the time it took. */
  private giveRecorded(p: Participant, index: number) {
    const recorded = p.script![index];
    if (!recorded || index !== this.index || this.phase !== 'question' || p.answer || !this.isActive(p)) return;
    if (recorded.powerup && !p.powerupThisQuestion) this.usePowerup(p.player.id, index, recorded.powerup);
    p.answer = recordedAnswer(recorded);
    this.toGame('game:answered', { playerId: p.player.id });
    this.maybeRevealEarly();
  }

  /**
   * A bot answers at once, as it was going to (its коз first, if it hadn't played it yet), with the time it would have
   * taken: its points are the same as if everyone had waited. One that zoned out stays without an answer. A recording
   * gives its recorded answer.
   */
  private botAnswerNow(p: Participant) {
    if (p.script) {
      this.giveRecorded(p, this.index);
      return;
    }
    const move = p.move;
    if (!move || p.answer) return;
    if (move.joker) this.usePowerup(p.player.id, this.index, move.joker);
    p.answer = this.botAnswer(p, move);
    this.toGame('game:answered', { playerId: p.player.id });
  }

  /**
   * Every human has been gone a while (or is knocked out): the rest of the match plays out at once, exactly as if they
   * had stayed and not answered — so dropping the connection can't lock in a lead. `quiet`: the knocked-out are still
   * watching; they get the result, not a flurry of questions. A round still to be picked is drawn.
   */
  private finishUnattended(quiet = false) {
    this.abandonTimer = null;
    this.quiet = quiet;
    this.picking = null;
    while (this.phase !== 'ended') {
      if (this.phase !== 'question') {
        const round = this.roundDue();
        if (round !== null) this.settleRound(round, shuffle(this.setup.rounds[round].offers)[0].category, null);
        this.nextQuestion();
        continue;
      }
      for (const p of this.participants.values()) {
        if (!this.isActive(p) || p.answer) continue;
        if (p.script) {
          const recorded = p.script[this.index];
          if (recorded) p.answer = recordedAnswer(recorded);
          continue;
        }
        if (!p.brain) continue;
        const move = this.botMove(p);
        if (move) p.answer = this.botAnswer(p, move);
      }
      this.reveal();
    }
  }

  private botReactions(results: Record<string, PlayerResult>) {
    for (const p of this.participants.values()) {
      const result = results[p.player.id];
      if (!p.brain || !result || Math.random() > 0.12) continue;
      const pool = result.correct ? BOT_EMOTES.good : BOT_EMOTES.bad;
      const emote = pool[Math.floor(Math.random() * pool.length)];
      this.later(300 + Math.random() * 1500, () => this.toGame('game:reaction', { playerId: p.player.id, emote }));
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  isActive(p: Participant) {
    return p.eliminatedAt === null && !p.left;
  }

  /**
   * Knocked out and still here („Играй до края“): a person answers on, outside the race — for XP, the almanac and what
   * they know, not for points or a place.
   */
  playsOn(p: Participant) {
    return p.eliminatedAt !== null && !p.left && p.player.userId !== null && !p.script;
  }

  private mayAnswer(p: Participant) {
    return this.isActive(p) || this.playsOn(p);
  }

  /** Who has answered: to everyone — or, from someone knocked out, to that player alone (no part of the race). */
  private answered(p: Participant) {
    if (this.isActive(p)) this.toGame('game:answered', { playerId: p.player.id });
    else this.emit.toUser(p.player.userId!, 'game:answered', { playerId: p.player.id });
  }

  /** Walked out while still in the game (leaving after being knocked out isn't a forfeit). */
  forfeited(p: Participant) {
    return p.left && p.eliminatedAt === null;
  }

  /** The other side walked out before the match got going: no win, no rating, no match played for whoever stayed. */
  get noContest() {
    return this.endedByWalkout && this.played < NO_CONTEST_QUESTIONS;
  }

  /** How much of the match was played: one cut short (by a walkout, or the server stopping) pays for what it took. */
  get playedShare() {
    return this.played / this.questions.length;
  }

  /** A multiplayer match is over once only one side is still in it. */
  private decided() {
    if (this.participants.size < 2) return false;
    const sides = new Set(
      [...this.participants.values()]
        .filter((p) => this.isActive(p))
        .map((p) => (this.setup.teams ? p.player.team : p.player.id)),
    );
    return sides.size < 2;
  }

  /** Milliseconds since the question opened, in game time. */
  private elapsed() {
    return (gameClock.now() - this.questionStartedAt) / config.gameTimeScale;
  }

  private consume(p: Participant, powerup: PowerupId) {
    p.usedPowerups.add(powerup);
    p.powerupThisQuestion = true;
    p.powerupNow = powerup;
  }

  /**
   * Best first: still in > knocked out later > knocked out earlier > walked out later > walked out earlier; then score,
   * accuracy, speed.
   */
  private ranked(): Participant[] {
    const group = (p: Participant) => (this.forfeited(p) ? 2 : p.eliminatedAt !== null ? 1 : 0);
    return [...this.participants.values()].sort(
      (a, b) =>
        group(a) - group(b) ||
        (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0) ||
        (b.leftOrder ?? 0) - (a.leftOrder ?? 0) ||
        b.score - a.score ||
        b.correct - a.correct ||
        a.answerMs - b.answerMs,
    );
  }

  standings(): Standing[] {
    return this.ranked().map((p, i) => ({
      id: p.player.id,
      score: p.score,
      correct: p.correct,
      streak: p.streak,
      rank: i + 1,
      eliminatedAt: p.eliminatedAt,
      left: this.forfeited(p),
      connected: p.connected,
    }));
  }

  private markHalfwayLast() {
    const active = this.ranked().filter((p) => this.isActive(p));
    if (active.length < 2) return;
    const last = active[active.length - 1];
    if (last.score < active[active.length - 2].score) last.lastAtHalfway = true;
  }

  private questionPayload(): QuestionPayload {
    const q = this.questions[this.index];
    return {
      id: q.id,
      index: this.index,
      total: this.questions.length,
      category: q.category,
      difficulty: q.difficulty,
      q: q.q,
      kind: q.kind === 'number' || q.kind === 'order' ? q.kind : 'choice',
      options: isChoice(q) ? q.options : [],
      number:
        q.kind === 'number'
          ? { unit: q.number.unit, min: q.number.min, max: q.number.max, step: q.number.step, scale: q.number.scale }
          : null,
      order: q.kind === 'order' ? { items: q.items.map((i) => i.text), direction: q.direction } : null,
      image: questionImage(q),
      final: this.atFinal,
      times: this.times,
      author: questionAuthor(q.id),
      durationMs: this.limitMs,
      remainingMs: Math.max(0, this.limitMs - this.elapsed()),
      speedMs: this.pace === 'untimed' ? null : this.scoreLimitMs,
      readMs: this.readMs,
      elimination: this.schedule.includes(this.index + 1),
      // The race's: one knocked out who answers on isn't in it.
      answered: [...this.participants.values()].filter((p) => p.answer && this.isActive(p)).map((p) => p.player.id),
    };
  }

  /** `playerId`: whose it is (null: the host's big screen, who holds no козове). */
  private startPayload(playerId: string | null, startsInMs: number): GameStartPayload {
    const p = playerId === null ? null : this.participants.get(playerId)!;
    return {
      gameId: this.id,
      mode: this.setup.mode,
      pace: this.pace,
      ranked: this.setup.ranked,
      roomCode: this.setup.roomCode,
      players: [...this.participants.values()].map((x) => x.player),
      youId: playerId ?? '',
      totalQuestions: this.questions.length,
      timeMs: this.setup.timeMs,
      category: this.setup.category,
      teams: this.setup.teams,
      eliminationSchedule: this.schedule,
      powerups: p?.powerups ?? [],
      usedPowerups: p ? [...p.usedPowerups] : [],
      emotes: p ? [...p.emotes] : [],
      standings: this.standings(),
      rounds: this.rounds,
      duelWith: this.setup.duelWith ?? null,
      questionSet: this.setup.questionSet ?? null,
      nextImage: this.nextImage(),
      startsInMs,
    };
  }

  private checkAbandoned() {
    const anyoneHere = this.humans.some((h) => !h.left && h.connected);
    if (anyoneHere || this.abandonTimer) return;
    const wait = this.alone ? ALONE_ABANDON_MS : ABANDON_MS;
    // Not one of `timers` (every reveal clears those), but on the same game clock.
    this.abandonTimer = setTimeout(() => this.guard(() => this.finishUnattended()), wait * config.gameTimeScale);
  }

  /** Everything the match's room hears goes through here (and nothing while it's being played out unwatched). */
  private toGame<E extends keyof Events>(event: E, ...args: Args<E>) {
    if (!this.quiet) this.emit.toGame(event, ...args);
  }

  private later(ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.guard(fn);
    }, Math.max(0, ms) * config.gameTimeScale);
    this.timers.add(t);
    return t;
  }

  /**
   * Runs a timer callback. A bug while running this match ends the match (the scores so far count) instead of crashing
   * the server and every other match with it.
   */
  private guard(fn: () => void) {
    try {
      fn();
    } catch (err) {
      void reportError(err, 'match', { extra: { match: this.id, mode: this.setup.mode } });
      this.cutShort = true;
      try {
        if (this.phase !== 'ended') return this.end();
      } catch (endErr) {
        void reportError(endErr, 'match end', { extra: { match: this.id } });
      }
      // Ending it failed too: drop the match so its players are free to play again.
      try {
        this.clearTimers();
        for (const p of this.humans) {
          if (!p.left)
            this.emit.toUser(p.player.userId!, 'notice', {
              kind: 'error',
              message: 'Мачът прекъсна заради грешка при нас. Съжаляваме!',
            });
        }
        this.hooks.onClosed(this);
      } catch (closeErr) {
        void reportError(closeErr, 'match close', { extra: { match: this.id } });
      }
    }
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.questionTimer = null;
  }

  private newParticipant(
    player: GamePlayer,
    brain: BotBrain | null,
    powerups: PowerupId[],
    emotes: string[],
  ): Participant {
    return {
      player,
      brain,
      script: null,
      powerups,
      usedPowerups: new Set(),
      emotes: new Set(brain ? [...BOT_EMOTES.good, ...BOT_EMOTES.bad] : emotes),
      score: 0,
      correct: 0,
      faced: 0,
      answered: 0,
      log: [],
      streak: 0,
      bestStreak: 0,
      fastestCorrectMs: null,
      fastestHardCorrectMs: null,
      correctMs: 0,
      answerMs: 0,
      correctByDifficulty: { easy: 0, medium: 0, hard: 0 },
      categories: new Map(),
      eliminatedAt: null,
      left: false,
      leftOrder: null,
      connected: true,
      disconnectedAt: null,
      lastAtHalfway: false,
      lastReactionAt: -Infinity,
      answer: null,
      doubled: false,
      removed: [],
      powerupThisQuestion: false,
      powerupNow: null,
      retryArmed: false,
      firstWrong: null,
      move: null,
    };
  }
}

/** Not a person: a bot, or a recording played back. */
const machine = (p: Participant) => !!(p.brain || p.script);

/** A recording's answer as the match takes it. */
function recordedAnswer(r: RecordedAnswer): NonNullable<Participant['answer']> {
  if (r.order) return { choice: -1, order: r.order, timeMs: r.timeMs, retried: false };
  if (r.value !== undefined) return { choice: -1, value: r.value, timeMs: r.timeMs, retried: false };
  return { choice: r.choice!, timeMs: r.timeMs, retried: r.retried };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** A normally distributed random number (mean 0, standard deviation 1). */
function gaussian() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
