import { randomUUID } from 'node:crypto';
import {
  type AnswerRejection,
  answerPoints,
  type CategoryChoice,
  type CategoryId,
  type Difficulty,
  eliminationSchedule,
  type FinalStanding,
  type GameEndPayload,
  type GamePlayer,
  type GameStartPayload,
  type MatchRewards,
  type ModeId,
  ordinal,
  type PlayerResult,
  POWERUPS,
  type PowerupId,
  type QuestionPayload,
  SCORING,
  type ServerToClientEvents,
  type Standing,
  type TeamId,
  TIME_BONUS_MS,
} from '@quiz/shared';
import { config } from '../config';
import { reportError } from '../monitoring';
import { type PreparedQuestion, shuffle } from '../questions';
import type { BotBrain } from './bots';

const COUNTDOWN_MS = 3_500;
/** Accept answers that were in flight when the clock hit zero. */
const GRACE_MS = 400;
/** Pause between the last answer arriving and the reveal. */
const EARLY_REVEAL_MS = 600;
const REVEAL_MS = 4_000;
const ELIMINATION_EXTRA_MS = 2_000;
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
/** A dropped connection (a page refresh, a tunnel) is waited for this long before the question can close without them. */
const DISCONNECT_GRACE_MS = 5_000;
const REACTION_COOLDOWN_MS = 700;
/** A match the other side walks out of before this many questions were played counts for nobody who stayed. */
const NO_CONTEST_QUESTIONS = 3;

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
  /** A one-attempt run ended without a result (cut short by us): the attempt is the player's again. */
  release(game: Game): void;
  /** The server is about to stop: a run waiting for an absent player shouldn't hold it up. */
  draining(): boolean;
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
  questions: PreparedQuestion[];
  humans: { player: GamePlayer; powerups: PowerupId[]; emotes: string[] }[];
  bots: { player: GamePlayer; brain: BotBrain }[];
}

export interface Participant {
  player: GamePlayer;
  brain: BotBrain | null;
  powerups: PowerupId[];
  usedPowerups: Set<PowerupId>;
  emotes: Set<string>;
  score: number;
  correct: number;
  /** Questions this player was still in the match for. */
  faced: number;
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
  answer: { choice: number; timeMs: number; retried: boolean } | null;
  doubled: boolean;
  removed: number[];
  powerupThisQuestion: boolean;
  extraMs: number;
  retryArmed: boolean;
  firstWrong: number | null;
}

type Phase = 'countdown' | 'question' | 'reveal' | 'ended';

const BOT_EMOTES = { good: ['fire', 'cool', 'thumbs'], bad: ['lol', 'wow', 'dead'] };
/** The козове bots play: the two about their own answer, a person's typical pair. */
const BOT_JOKERS: readonly PowerupId[] = ['fifty', 'double'];

export class Game {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  readonly participants = new Map<string, Participant>();
  readonly schedule: number[];
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
  /** A run played alone, paused before its next question until its player is back. */
  held = false;
  /** A run played alone whose player stopped on the fact (each stop gets a number, so an old timer can't end a new one). */
  private reading = 0;
  private readingSeq = 0;
  /** The reveal ended while they were reading: the next question comes when they go on. */
  private waitingForReader = false;

  private questionStartedAt = 0;
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
    for (const h of setup.humans)
      this.participants.set(h.player.id, this.newParticipant(h.player, null, h.powerups, h.emotes));
    for (const b of setup.bots)
      this.participants.set(b.player.id, this.newParticipant(b.player, b.brain, [...BOT_JOKERS], []));
    this.alone = solo;
    this.schedule =
      setup.elimination && !setup.teams ? eliminationSchedule(this.participants.size, setup.questions.length) : [];
  }

  get questions() {
    return this.setup.questions;
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
    this.later(COUNTDOWN_MS, () => this.advance());
  }

  // ─── Player actions ──────────────────────────────────────────────────────

  answer(playerId: string, index: number, choice: number) {
    const p = this.participants.get(playerId);
    if (!p || !this.isActive(p) || p.answer || this.phase === 'ended') return;
    // The client drew the pick as locked in: say why it wasn't taken, so it can unlock it and tell the player.
    const reject = (reason: AnswerRejection) => {
      if (!p.brain) this.emit.toUser(p.player.userId!, 'game:rejected', { index, reason });
    };
    if (this.phase !== 'question' || index !== this.index) return reject('late');
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return;
    if (p.removed.includes(choice)) return reject('removed');
    const limit = this.setup.timeMs + p.extraMs;
    const elapsed = this.elapsed();
    if (elapsed > limit + GRACE_MS) return reject('late');

    const q = this.questions[this.index];
    if (p.retryArmed && p.firstWrong === null && choice !== q.answer) {
      // "Втори шанс": the first miss isn't final.
      p.firstWrong = choice;
      p.removed = [...p.removed, choice];
      this.emit.toUser(p.player.userId!, 'game:retry', { wrong: choice });
      return;
    }
    p.answer = { choice, timeMs: Math.min(elapsed, limit), retried: p.firstWrong !== null };
    this.toGame('game:answered', { playerId });
    this.maybeRevealEarly();
  }

  usePowerup(playerId: string, index: number, powerup: PowerupId) {
    const p = this.participants.get(playerId);
    if (!p || this.phase !== 'question' || index !== this.index || !this.isActive(p) || p.answer) return;
    if (!p.powerups.includes(powerup) || p.usedPowerups.has(powerup) || p.powerupThisQuestion) return;
    const userId = p.player.userId!;
    const q = this.questions[this.index];
    if (q.difficulty === 'easy' && POWERUPS.find((d) => d.id === powerup)?.notOnEasy) return;

    this.consume(p, powerup);
    switch (powerup) {
      case 'fifty':
        p.removed = shuffle([0, 1, 2, 3].filter((i) => i !== q.answer && !p.removed.includes(i))).slice(0, 2);
        // A bot has nobody to tell which ones went; the others only see that it was played.
        if (p.brain) this.toGame('game:powerup', { playerId, powerup });
        else {
          this.emit.toUser(userId, 'game:powerup', { playerId, powerup, removed: p.removed });
          this.emit.toGameExcept(userId, 'game:powerup', { playerId, powerup });
        }
        break;
      case 'double':
        p.doubled = true;
        this.toGame('game:powerup', { playerId, powerup });
        break;
      case 'retry':
        p.retryArmed = true;
        this.toGame('game:powerup', { playerId, powerup });
        break;
      case 'time':
        p.extraMs = TIME_BONUS_MS;
        this.emit.toUser(userId, 'game:powerup', { playerId, powerup, extraMs: TIME_BONUS_MS });
        this.emit.toGameExcept(userId, 'game:powerup', { playerId, powerup });
        this.rescheduleQuestionTimer();
        break;
    }
  }

  /**
   * "Спри, за да прочета": in a run played alone, the player stops on the question's fact to read it. Only during the reveal of the
   * question on screen (nobody else is waiting); the next question then waits for resume(), or FACT_HOLD_MS.
   */
  hold(playerId: string, index: number): boolean {
    if (!this.alone || this.phase !== 'reveal' || index !== this.index || this.reading) return false;
    if (!this.participants.has(playerId) || !this.questions[this.index]?.fact) return false;
    const seq = ++this.readingSeq;
    this.reading = seq;
    this.later(FACT_HOLD_MS, () => this.resume(playerId, seq));
    return true;
  }

  /** On with the run after a fact (or after FACT_HOLD_MS: `seq` says which stop the timer was for). */
  resume(playerId: string, seq = this.reading) {
    if (!this.reading || seq !== this.reading || !this.participants.has(playerId)) return;
    this.reading = 0;
    if (!this.waitingForReader) return;
    this.waitingForReader = false;
    this.advance();
  }

  react(playerId: string, emote: string) {
    const p = this.participants.get(playerId);
    if (!p || this.phase === 'ended' || !p.emotes.has(emote)) return;
    const now = Date.now();
    if (now - p.lastReactionAt < REACTION_COOLDOWN_MS) return;
    p.lastReactionAt = now;
    this.toGame('game:reaction', { playerId, emote });
  }

  leave(playerId: string) {
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
  }

  setConnected(playerId: string, connected: boolean) {
    const p = this.participants.get(playerId);
    if (!p || p.left || p.connected === connected || this.phase === 'ended') return;
    p.connected = connected;
    p.disconnectedAt = connected ? null : Date.now();
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
  }

  /**
   * Payloads that bring a (re)connecting client up to speed, including where this player stands on the open question
   * (their pick, козове, extra time): a fresh tab has none of it.
   */
  syncFor(playerId: string): { start: GameStartPayload; question: QuestionPayload | null } {
    const p = this.participants.get(playerId)!;
    return {
      start: this.startPayload(playerId, 0),
      question:
        this.phase === 'question'
          ? {
              ...this.questionPayload(),
              remainingMs: Math.max(0, this.setup.timeMs + p.extraMs - this.elapsed()),
              mine: {
                choice: p.answer?.choice ?? null,
                removed: p.removed,
                doubled: p.doubled,
                retryArmed: p.retryArmed,
                retryPrompt: p.firstWrong !== null && !p.answer,
                extraMs: p.extraMs,
                powerupThisQuestion: p.powerupThisQuestion,
              },
            }
          : null,
    };
  }

  /**
   * The server is stopping and can't wait any longer: the match ends here, and the scores so far count (unrated: we cut
   * it, not the players). A run played alone gets its attempt back instead.
   */
  stop() {
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
    if (this.reading) {
      this.waitingForReader = true;
      return;
    }
    if (this.alone && !this.humans[0]?.connected) {
      if (this.hooks.draining()) return this.stop();
      this.held = true;
      return;
    }
    if (this.participants.size > 1 && !this.humans.some((h) => this.isActive(h))) return this.finishUnattended(true);
    this.nextQuestion();
  }

  private nextQuestion() {
    this.index++;
    if (this.index >= this.questions.length) return this.end();
    this.phase = 'question';
    this.questionStartedAt = Date.now();
    for (const p of this.participants.values()) {
      p.answer = null;
      p.doubled = false;
      p.removed = [];
      p.powerupThisQuestion = false;
      p.extraMs = 0;
      p.retryArmed = false;
      p.firstWrong = null;
    }
    this.toGame('game:question', this.questionPayload());
    this.scheduleBots();
    this.questionTimer = this.later(this.setup.timeMs + GRACE_MS, () => this.reveal());
  }

  /** "Още време" pushes the round's end out to cover the longest personal deadline. */
  private rescheduleQuestionTimer() {
    if (this.phase !== 'question') return;
    const longest = Math.max(...[...this.participants.values()].map((p) => p.extraMs));
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = this.later(this.setup.timeMs + longest + GRACE_MS - this.elapsed(), () => this.reveal());
  }

  private maybeRevealEarly() {
    if (this.phase !== 'question') return;
    const now = Date.now();
    const reconnecting = (p: Participant) =>
      p.disconnectedAt !== null && now - p.disconnectedAt < DISCONNECT_GRACE_MS * config.gameTimeScale;
    // Alone, the clock is the only limit: nobody else is waiting for the question to close.
    const waitingOn = [...this.participants.values()].filter(
      (p) => this.isActive(p) && (this.alone || p.connected || p.brain || reconnecting(p)),
    );
    if (waitingOn.some((p) => !p.answer)) return;
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = this.later(EARLY_REVEAL_MS, () => this.reveal());
  }

  private reveal() {
    if (this.phase !== 'question') return;
    this.phase = 'reveal';
    this.played++;
    this.clearTimers();

    const q = this.questions[this.index];
    const results: Record<string, PlayerResult> = {};
    for (const p of this.participants.values()) {
      if (!this.isActive(p)) continue;
      // A "Втори шанс" miss with no second pick stands as the answer.
      if (!p.answer && p.firstWrong !== null)
        p.answer = { choice: p.firstWrong, timeMs: this.setup.timeMs + p.extraMs, retried: false };
      p.faced++;
      const cat = p.categories.get(q.category) ?? { answered: 0, correct: 0, correctMs: 0 };
      p.categories.set(q.category, cat);
      cat.answered++;

      const correct = p.answer?.choice === q.answer;
      let points = 0;
      // Tie-breaks compare total time, so a question left unanswered costs the whole clock.
      p.answerMs += p.answer?.timeMs ?? this.setup.timeMs + p.extraMs;
      if (correct && p.answer) {
        const { timeMs, retried } = p.answer;
        p.streak++;
        p.correct++;
        p.correctByDifficulty[q.difficulty]++;
        p.correctMs += timeMs;
        cat.correct++;
        cat.correctMs += timeMs;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        p.fastestCorrectMs = p.fastestCorrectMs === null ? timeMs : Math.min(p.fastestCorrectMs, timeMs);
        if (q.difficulty !== 'easy') p.fastestHardCorrectMs = Math.min(p.fastestHardCorrectMs ?? timeMs, timeMs);
        points = answerPoints({ timeMs, limitMs: this.setup.timeMs, streak: p.streak, doubled: p.doubled, retried });
      } else {
        p.streak = 0;
        // "Двойно или нищо" is a bet: a miss costs points (never below zero).
        if (p.doubled && p.score > 0) points = -Math.min(SCORING.doubleStake, p.score);
      }
      p.score += points;
      results[p.player.id] = {
        choice: p.answer?.choice ?? null,
        correct,
        points,
        timeMs: p.answer?.timeMs ?? null,
        streak: p.streak,
        doubled: p.doubled,
        retried: !!p.answer?.retried && correct,
      };
    }

    const questionNo = this.index + 1;
    if (questionNo === Math.floor(this.questions.length / 2)) this.markHalfwayLast();

    const eliminated: string[] = [];
    const active = this.ranked().filter((p) => this.isActive(p));
    if (this.schedule.includes(questionNo) && active.length > 2) {
      const loser = active[active.length - 1];
      loser.eliminatedAt = questionNo;
      eliminated.push(loser.player.id);
    }

    const nextInMs = REVEAL_MS + (eliminated.length ? ELIMINATION_EXTRA_MS : 0);
    this.toGame('game:reveal', {
      index: this.index,
      correct: q.answer,
      results,
      standings: this.standings(),
      eliminated,
      nextInMs,
      fact: q.fact ?? null,
    });
    this.botReactions(results);
    this.later(nextInMs, () => this.advance());
  }

  private end() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimers();
    if (this.abandonTimer) clearTimeout(this.abandonTimer);

    // A one-attempt run we cut short has no fair result: nothing is saved and the attempt is the player's again.
    if (this.cutShort && (this.setup.dailyDay || this.setup.challengeId)) {
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
    this.hooks.onClosed(this);
  }

  // ─── Teams ───────────────────────────────────────────────────────────────

  /** Team totals, winner first. A team that walked out loses; ties go to more correct answers, then faster total time. */
  teamScores(): { team: TeamId; score: number }[] {
    const totals = ([0, 1] as TeamId[]).map((team) => {
      const members = [...this.participants.values()].filter((p) => p.player.team === team);
      return {
        team,
        gone: members.every((p) => p.left),
        score: members.reduce((s, p) => s + p.score, 0),
        correct: members.reduce((s, p) => s + p.correct, 0),
        time: members.reduce((s, p) => s + p.answerMs, 0),
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
   * How a bot plays the current question: whether it knows the answer, how long it takes (game ms), and a joker it
   * plays on the way, as a person would — 50/50 when it doesn't know, "Двойно или нищо" mostly when it does (now and
   * then on a hunch, which costs it). Null when it zones out.
   */
  private botMove(p: Participant): { knows: boolean; afterMs: number; joker: PowerupId | null } | null {
    const brain = p.brain!;
    const q = this.questions[this.index];
    if (Math.random() < 0.04) return null; // zoned out — lets the clock run down
    const difficultyShift = { easy: 0.15, medium: 0, hard: -0.2 }[q.difficulty];
    const knows = Math.random() < clamp(brain.accuracy + difficultyShift, 0.1, 0.97);
    const fraction = clamp(brain.pace + (Math.random() - 0.5) * 0.35 + (knows ? -0.05 : 0.1), 0.08, 0.92);
    const playable = (id: PowerupId) =>
      p.powerups.includes(id) &&
      !p.usedPowerups.has(id) &&
      !(q.difficulty === 'easy' && POWERUPS.find((d) => d.id === id)?.notOnEasy);
    const joker =
      !knows && playable('fifty') && Math.random() < 0.35
        ? 'fifty'
        : playable('double') && Math.random() < (knows ? 0.25 : 0.06)
          ? 'double'
          : null;
    return { knows, afterMs: Math.max(900, fraction * this.setup.timeMs), joker };
  }

  /** A bot's pick: the answer if it knows it; else a wrong one — or, once 50/50 has left two, a coin toss. */
  private botChoice(p: Participant, knows: boolean): number {
    const q = this.questions[this.index];
    if (knows) return q.answer;
    const wrong = [0, 1, 2, 3].filter((i) => i !== q.answer && !p.removed.includes(i));
    if (p.removed.length) return Math.random() < 0.5 ? q.answer : wrong[0];
    return wrong[Math.floor(Math.random() * wrong.length)];
  }

  private scheduleBots() {
    const index = this.index;
    for (const p of this.participants.values()) {
      if (!p.brain || !this.isActive(p)) continue;
      const move = this.botMove(p);
      if (!move) continue;
      const { joker } = move;
      if (joker) this.later(move.afterMs * 0.4, () => this.usePowerup(p.player.id, index, joker));
      this.later(move.afterMs, () => this.answer(p.player.id, index, this.botChoice(p, move.knows)));
    }
  }

  /**
   * Every human has been gone a while (or is knocked out): the rest of the match plays out at once, exactly as if they
   * had stayed and not answered — so dropping the connection can't lock in a lead. `quiet`: the knocked-out are still
   * watching; they get the result, not a flurry of questions.
   */
  private finishUnattended(quiet = false) {
    this.abandonTimer = null;
    this.quiet = quiet;
    while (this.phase !== 'ended') {
      if (this.phase !== 'question') {
        this.nextQuestion();
        continue;
      }
      for (const p of this.participants.values()) {
        if (!p.brain || !this.isActive(p) || p.answer) continue;
        const move = this.botMove(p);
        if (move) p.answer = { choice: this.botChoice(p, move.knows), timeMs: move.afterMs, retried: false };
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
    return (Date.now() - this.questionStartedAt) / config.gameTimeScale;
  }

  private consume(p: Participant, powerup: PowerupId) {
    p.usedPowerups.add(powerup);
    p.powerupThisQuestion = true;
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
      options: q.options,
      author: q.author ?? null,
      durationMs: this.setup.timeMs,
      remainingMs: Math.max(0, this.setup.timeMs - this.elapsed()),
      elimination: this.schedule.includes(this.index + 1),
      answered: [...this.participants.values()].filter((p) => p.answer).map((p) => p.player.id),
    };
  }

  private startPayload(playerId: string, startsInMs: number): GameStartPayload {
    const p = this.participants.get(playerId)!;
    return {
      gameId: this.id,
      mode: this.setup.mode,
      ranked: this.setup.ranked,
      roomCode: this.setup.roomCode,
      players: [...this.participants.values()].map((x) => x.player),
      youId: playerId,
      totalQuestions: this.questions.length,
      timeMs: this.setup.timeMs,
      category: this.setup.category,
      teams: this.setup.teams,
      eliminationSchedule: this.schedule,
      powerups: p.powerups,
      usedPowerups: [...p.usedPowerups],
      emotes: [...p.emotes],
      standings: this.standings(),
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
      powerups,
      usedPowerups: new Set(),
      emotes: new Set(brain ? [...BOT_EMOTES.good, ...BOT_EMOTES.bad] : emotes),
      score: 0,
      correct: 0,
      faced: 0,
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
      lastReactionAt: 0,
      answer: null,
      doubled: false,
      removed: [],
      powerupThisQuestion: false,
      extraMs: 0,
      retryArmed: false,
      firstWrong: null,
    };
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
