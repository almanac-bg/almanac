import { randomUUID } from 'node:crypto';
import {
  type CategoryChoice,
  type CategoryId,
  type Difficulty,
  eliminationSchedule,
  type FinalStanding,
  FREEZE_MS,
  type GameEndPayload,
  type GamePlayer,
  type GameStartPayload,
  type MatchRewards,
  type ModeId,
  type PlayerResult,
  type PowerupId,
  POWERUPS,
  type QuestionPayload,
  SCORING,
  type ServerToClientEvents,
  type Standing,
  type TeamId,
  TIME_BONUS_MS,
} from '@quiz/shared';
import { config } from '../config';
import { type PreparedQuestion, shuffle } from '../questions';
import type { BotBrain } from './bots';

const COUNTDOWN_MS = 3_500;
/** Accept answers that were in flight when the clock hit zero. */
const GRACE_MS = 400;
/** Pause between the last answer arriving and the reveal. */
const EARLY_REVEAL_MS = 600;
const REVEAL_MS = 4_000;
const ELIMINATION_EXTRA_MS = 2_000;
/** End the match if every human has been disconnected this long. */
const ABANDON_MS = 30_000;
const REACTION_COOLDOWN_MS = 700;

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
  correctMs: number;
  answerMs: number;
  correctByDifficulty: Record<Difficulty, number>;
  categories: Map<CategoryId, { answered: number; correct: number; correctMs: number }>;
  eliminatedAt: number | null;
  left: boolean;
  connected: boolean;
  /** Was strictly last at the halfway point (for the comeback achievement). */
  lastAtHalfway: boolean;
  freezesUsed: number;
  lastReactionAt: number;
  // Per-question state, reset by nextQuestion():
  answer: { choice: number; timeMs: number; retried: boolean } | null;
  doubled: boolean;
  removed: number[];
  powerupThisQuestion: boolean;
  frozenUntil: number;
  extraMs: number;
  retryArmed: boolean;
  firstWrong: number | null;
}

type Phase = 'countdown' | 'question' | 'reveal' | 'ended';

const BOT_EMOTES = { good: ['fire', 'cool', 'thumbs'], bad: ['lol', 'wow', 'dead'] };

export class Game {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  readonly participants = new Map<string, Participant>();
  readonly schedule: number[];
  phase: Phase = 'countdown';
  index = -1;

  private questionStartedAt = 0;
  private timers = new Set<NodeJS.Timeout>();
  private questionTimer: NodeJS.Timeout | null = null;
  private abandonTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly setup: GameSetup,
    private emit: GameEmitter,
    private hooks: GameHooks,
  ) {
    const solo = setup.humans.length + setup.bots.length === 1;
    for (const h of setup.humans) {
      // Targeted power-ups are pointless without an opponent.
      const powerups = solo ? h.powerups.filter((id) => !POWERUPS.find((p) => p.id === id)?.multiplayerOnly) : h.powerups;
      this.participants.set(h.player.id, this.newParticipant(h.player, null, powerups, h.emotes));
    }
    for (const b of setup.bots) this.participants.set(b.player.id, this.newParticipant(b.player, b.brain, [], []));
    this.schedule = setup.elimination && !setup.teams ? eliminationSchedule(this.participants.size, setup.questions.length) : [];
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
    for (const p of this.humans) this.emit.toUser(p.player.userId!, 'game:start', this.startPayload(p.player.id, COUNTDOWN_MS));
    this.later(COUNTDOWN_MS, () => this.nextQuestion());
  }

  // ─── Player actions ──────────────────────────────────────────────────────

  answer(playerId: string, index: number, choice: number) {
    const p = this.participants.get(playerId);
    if (!p || this.phase !== 'question' || index !== this.index || !this.isActive(p) || p.answer) return;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3 || p.removed.includes(choice)) return;
    const now = Date.now();
    if (p.frozenUntil > now) {
      // Bots wait the freeze out; humans' clients keep the buttons disabled.
      if (p.brain) this.later((p.frozenUntil - now) / config.gameTimeScale + 300, () => this.answer(playerId, index, choice));
      return;
    }
    const limit = this.setup.timeMs + p.extraMs;
    const elapsed = this.elapsed();
    if (elapsed > limit + GRACE_MS) return;

    const q = this.questions[this.index];
    if (p.retryArmed && p.firstWrong === null && choice !== q.answer) {
      // "Втори шанс": the first miss isn't final.
      p.firstWrong = choice;
      p.removed = [...p.removed, choice];
      this.emit.toUser(p.player.userId!, 'game:retry', { wrong: choice });
      return;
    }
    p.answer = { choice, timeMs: Math.min(elapsed, limit), retried: p.firstWrong !== null };
    this.emit.toGame('game:answered', { playerId });
    this.maybeRevealEarly();
  }

  usePowerup(playerId: string, index: number, powerup: PowerupId) {
    const p = this.participants.get(playerId);
    if (!p || this.phase !== 'question' || index !== this.index || !this.isActive(p) || p.answer) return;
    if (!p.powerups.includes(powerup) || p.usedPowerups.has(powerup) || p.powerupThisQuestion) return;
    const userId = p.player.userId!;
    const q = this.questions[this.index];

    if (powerup === 'freeze') {
      const target = this.freezeTarget(p);
      if (!target) {
        this.emit.toUser(userId, 'notice', { kind: 'info', message: 'Няма кого да замразиш — съперниците вече отговориха.' });
        return;
      }
      target.frozenUntil = Date.now() + FREEZE_MS * config.gameTimeScale;
      p.freezesUsed++;
      this.consume(p, powerup);
      this.emit.toGame('game:powerup', { playerId, powerup, targetId: target.player.id });
      return;
    }

    this.consume(p, powerup);
    switch (powerup) {
      case 'fifty':
        p.removed = shuffle([0, 1, 2, 3].filter((i) => i !== q.answer && !p.removed.includes(i))).slice(0, 2);
        this.emit.toUser(userId, 'game:powerup', { playerId, powerup, removed: p.removed });
        this.emit.toGameExcept(userId, 'game:powerup', { playerId, powerup });
        break;
      case 'double':
        p.doubled = true;
        this.emit.toGame('game:powerup', { playerId, powerup });
        break;
      case 'retry':
        p.retryArmed = true;
        this.emit.toGame('game:powerup', { playerId, powerup });
        break;
      case 'time':
        p.extraMs = TIME_BONUS_MS;
        this.emit.toUser(userId, 'game:powerup', { playerId, powerup, extraMs: TIME_BONUS_MS });
        this.emit.toGameExcept(userId, 'game:powerup', { playerId, powerup });
        this.rescheduleQuestionTimer();
        break;
    }
  }

  react(playerId: string, emote: string) {
    const p = this.participants.get(playerId);
    if (!p || this.phase === 'ended' || !p.emotes.has(emote)) return;
    const now = Date.now();
    if (now - p.lastReactionAt < REACTION_COOLDOWN_MS) return;
    p.lastReactionAt = now;
    this.emit.toGame('game:reaction', { playerId, emote });
  }

  leave(playerId: string) {
    const p = this.participants.get(playerId);
    if (!p || p.left || this.phase === 'ended') return;
    p.left = true;
    p.connected = false;
    this.emit.toGame('game:presence', { playerId, connected: false, left: true });
    if (this.humans.every((h) => h.left)) return this.end();
    this.maybeRevealEarly();
    this.checkAbandoned();
  }

  setConnected(playerId: string, connected: boolean) {
    const p = this.participants.get(playerId);
    if (!p || p.left || p.connected === connected || this.phase === 'ended') return;
    p.connected = connected;
    this.emit.toGame('game:presence', { playerId, connected, left: false });
    if (connected && this.abandonTimer) {
      clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
    }
    if (!connected) {
      this.maybeRevealEarly();
      this.checkAbandoned();
    }
  }

  /** Payloads that bring a (re)connecting client up to speed. */
  syncFor(playerId: string): { start: GameStartPayload; question: QuestionPayload | null } {
    return {
      start: this.startPayload(playerId, 0),
      question: this.phase === 'question' ? this.questionPayload() : null,
    };
  }

  // ─── Flow ────────────────────────────────────────────────────────────────

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
      p.frozenUntil = 0;
      p.extraMs = 0;
      p.retryArmed = false;
      p.firstWrong = null;
    }
    this.emit.toGame('game:question', this.questionPayload());
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
    const waitingOn = [...this.participants.values()].filter((p) => this.isActive(p) && (p.connected || p.brain));
    if (waitingOn.some((p) => !p.answer)) return;
    if (this.questionTimer) clearTimeout(this.questionTimer);
    this.questionTimer = this.later(EARLY_REVEAL_MS, () => this.reveal());
  }

  private reveal() {
    if (this.phase !== 'question') return;
    this.phase = 'reveal';
    this.clearTimers();

    const q = this.questions[this.index];
    const results: Record<string, PlayerResult> = {};
    for (const p of this.participants.values()) {
      if (!this.isActive(p)) continue;
      // A "Втори шанс" miss with no second pick stands as the answer.
      if (!p.answer && p.firstWrong !== null) p.answer = { choice: p.firstWrong, timeMs: this.setup.timeMs + p.extraMs, retried: false };
      p.faced++;
      const cat = p.categories.get(q.category) ?? { answered: 0, correct: 0, correctMs: 0 };
      p.categories.set(q.category, cat);
      cat.answered++;

      const correct = p.answer?.choice === q.answer;
      let points = 0;
      if (p.answer) p.answerMs += p.answer.timeMs;
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
        const speed = Math.round(SCORING.speed * Math.max(0, 1 - timeMs / (this.setup.timeMs + p.extraMs)));
        const streakBonus = Math.min((p.streak - 1) * SCORING.streakStep, SCORING.streakMax);
        points = Math.round((SCORING.base + speed + streakBonus) * (p.doubled ? 2 : 1) * (retried ? 0.5 : 1));
      } else {
        p.streak = 0;
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
    this.emit.toGame('game:reveal', {
      index: this.index,
      correct: q.answer,
      results,
      standings: this.standings(),
      eliminated,
      nextInMs,
    });
    this.botReactions(results);
    this.later(nextInMs, () => this.nextQuestion());
  }

  private end() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimers();
    if (this.abandonTimer) clearTimeout(this.abandonTimer);

    const teamScores = this.setup.teams ? this.teamScores() : null;
    const standings = this.finalStandings(teamScores);
    let rewards = new Map<number, MatchRewards>();
    try {
      rewards = this.hooks.finalize(this, standings);
    } catch (err) {
      console.error(`Failed to persist match ${this.id}`, err);
    }
    for (const p of this.humans) {
      if (p.left) continue;
      const userId = p.player.userId!;
      const payload: GameEndPayload = {
        gameId: this.id,
        mode: this.setup.mode,
        ranked: this.setup.ranked,
        roomCode: this.setup.roomCode,
        standings,
        teamScores,
        rewards: rewards.get(userId) ?? null,
      };
      this.emit.toUser(userId, 'game:end', payload);
    }
    this.hooks.onClosed(this);
  }

  // ─── Teams ───────────────────────────────────────────────────────────────

  /** Team totals, winner first. Ties go to more correct answers, then faster total time. */
  teamScores(): { team: TeamId; score: number }[] {
    const totals = ([0, 1] as TeamId[]).map((team) => {
      const members = [...this.participants.values()].filter((p) => p.player.team === team);
      return {
        team,
        score: members.reduce((s, p) => s + p.score, 0),
        correct: members.reduce((s, p) => s + p.correct, 0),
        time: members.reduce((s, p) => s + p.answerMs, 0),
      };
    });
    totals.sort((a, b) => b.score - a.score || b.correct - a.correct || a.time - b.time);
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
        return { ...s, placement: p.player.team === winner && !p.left ? 1 : 2 };
      })
      .sort((a, b) => a.placement - b.placement || a.rank - b.rank);
  }

  // ─── Bots ────────────────────────────────────────────────────────────────

  private scheduleBots() {
    const q = this.questions[this.index];
    const index = this.index;
    const difficultyShift = { easy: 0.15, medium: 0, hard: -0.2 }[q.difficulty];
    for (const p of this.participants.values()) {
      if (!p.brain || !this.isActive(p)) continue;
      if (Math.random() < 0.04) continue; // zoned out — lets the clock run down
      const correct = Math.random() < clamp(p.brain.accuracy + difficultyShift, 0.1, 0.97);
      const wrong = [0, 1, 2, 3].filter((i) => i !== q.answer);
      const choice = correct ? q.answer : wrong[Math.floor(Math.random() * wrong.length)];
      const fraction = clamp(p.brain.pace + (Math.random() - 0.5) * 0.35 + (correct ? -0.05 : 0.1), 0.08, 0.92);
      this.later(Math.max(900, fraction * this.setup.timeMs), () => this.answer(p.player.id, index, choice));
    }
  }

  private botReactions(results: Record<string, PlayerResult>) {
    for (const p of this.participants.values()) {
      const result = results[p.player.id];
      if (!p.brain || !result || Math.random() > 0.12) continue;
      const pool = result.correct ? BOT_EMOTES.good : BOT_EMOTES.bad;
      const emote = pool[Math.floor(Math.random() * pool.length)];
      this.later(300 + Math.random() * 1500, () => this.emit.toGame('game:reaction', { playerId: p.player.id, emote }));
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  isActive(p: Participant) {
    return p.eliminatedAt === null && !p.left;
  }

  /** Milliseconds since the question opened, in game time. */
  private elapsed() {
    return (Date.now() - this.questionStartedAt) / config.gameTimeScale;
  }

  private consume(p: Participant, powerup: PowerupId) {
    p.usedPowerups.add(powerup);
    p.powerupThisQuestion = true;
  }

  /** The best-placed opponent who hasn't answered yet and isn't already frozen. */
  private freezeTarget(by: Participant): Participant | null {
    const now = Date.now();
    return (
      this.ranked().find(
        (o) =>
          o !== by &&
          this.isActive(o) &&
          !o.answer &&
          o.frozenUntil <= now &&
          (!this.setup.teams || o.player.team !== by.player.team),
      ) ?? null
    );
  }

  /** Best first: still in > knocked out later > knocked out earlier > left; then score, accuracy, speed. */
  private ranked(): Participant[] {
    return [...this.participants.values()].sort(
      (a, b) =>
        Number(a.left) - Number(b.left) ||
        (b.eliminatedAt ?? Infinity) - (a.eliminatedAt ?? Infinity) ||
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
      left: p.left,
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
    this.abandonTimer = setTimeout(() => this.end(), ABANDON_MS);
  }

  private later(ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(
      () => {
        this.timers.delete(t);
        fn();
      },
      Math.max(0, ms) * config.gameTimeScale,
    );
    this.timers.add(t);
    return t;
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.questionTimer = null;
  }

  private newParticipant(player: GamePlayer, brain: BotBrain | null, powerups: PowerupId[], emotes: string[]): Participant {
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
      correctMs: 0,
      answerMs: 0,
      correctByDifficulty: { easy: 0, medium: 0, hard: 0 },
      categories: new Map(),
      eliminatedAt: null,
      left: false,
      connected: true,
      lastAtHalfway: false,
      freezesUsed: 0,
      lastReactionAt: 0,
      answer: null,
      doubled: false,
      removed: [],
      powerupThisQuestion: false,
      frozenUntil: 0,
      extraMs: 0,
      retryArmed: false,
      firstWrong: null,
    };
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
