import type {
  CategoryId,
  Crowd,
  Difficulty,
  EveningStatus,
  GameEndPayload,
  GamePlayer,
  GameStartPayload,
  ImageCredit,
  Invite,
  LobbyStats,
  MeUser,
  NumberInput,
  PickPayload,
  PowerupId,
  QuestionImage,
  QuestionPayload,
  QueueStatus,
  RematchState,
  RevealPayload,
  RoomState,
  RoundInfo,
  Standing,
} from '@quiz/shared';
import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  title: string;
  body?: string;
  icon?: string;
  /** How long it stays on screen (the screen's clock pauses while it's pointed at or focused). */
  ttlMs: number;
}

/** An error stays at least this long: it has to be read, and it's what someone needs to act on. */
export const ERROR_TOAST_MS = 10_000;

/** `pick`: before a round, while its category is picked and shown. */
export type GamePhase = 'countdown' | 'question' | 'reveal' | 'pick' | 'ended';

/** One finished question of the match, for the review afterwards. */
export interface ReviewItem {
  id: string;
  index: number;
  q: string;
  options: string[];
  category: CategoryId;
  difficulty: Difficulty;
  /** The right option; −1 on a number question. */
  correct: number;
  /** Your pick; null if you didn't answer (or were already out), or on a number question. */
  choice: number | null;
  /** On a number question: its answer (with what it takes to write it), your number (null: none), how close (0–1). */
  number:
    | (Pick<NumberInput, 'unit' | 'step' | 'scale'> & { answer: number; guess: number | null; closeness: number })
    | null;
  /**
   * On an order question: its items as shown, the right order and yours (the items' indices, first to last; null: none
   * in time), each item's value and what the values count, and how many you had in place.
   */
  order: {
    items: string[];
    right: number[];
    given: number[] | null;
    values: number[] | null;
    unit: string;
    placed: number;
  } | null;
  /** The question's picture, and whose it is. */
  image: (QuestionImage & { credit: ImageCredit | null }) | null;
  right: boolean;
  /** "Знаеше ли?" behind the answer, when the question has one. */
  fact: string | null;
  /** How everyone before answered it, once enough have: „62% знаят“, and each option's share. */
  crowd: Crowd | null;
}

export interface LiveGame {
  start: GameStartPayload;
  players: Record<string, GamePlayer>;
  standings: Standing[];
  phase: GamePhase;
  countdownEndsAt: number;
  question: QuestionPayload | null;
  /** Local timestamp when the current question closes. */
  deadline: number;
  answered: string[];
  /**
   * Your pick (-1 = locked in with no option to show: before a reconnect, or a number). It's in once `answered`
   * includes you.
   */
  myChoice: number | null;
  /** Your number, on a number question. */
  myGuess: number | null;
  /** Your order, on an order question, once sent (the shown items' indices, first to last). */
  myOrder: number[] | null;
  removed: number[];
  doubled: boolean;
  usedPowerups: PowerupId[];
  /** A joker was already played on this question (one per question). */
  powerupThisQuestion: boolean;
  /** "Втори шанс" is armed for this question. */
  retryArmed: boolean;
  /** The first pick was wrong and a second one is allowed. */
  retryPrompt: boolean;
  reveal: RevealPayload | null;
  /** Just reconnected: until the server re-sends the question on screen, it may already be closed. */
  resyncing: boolean;
  /** In a match in rounds: each round's category, as far as it's decided. */
  rounds: RoundInfo[];
  /**
   * The round being picked (`endsAt`: local time its pick closes; `sent`: your pick, on its way; `chosen`: the
   * category, once decided).
   */
  pick: (PickPayload & { endsAt: number; sent: string | null; chosen: string | null }) | null;
  eliminated: string[];
  reactions: { key: number; playerId: string; emote: string }[];
  feed: { key: number; text: string; icon: string }[];
  /** Questions revealed so far (since you joined or reconnected). */
  history: ReviewItem[];
  end: GameEndPayload | null;
}

interface State {
  me: MeUser | null;
  authChecked: boolean;
  connected: boolean;
  /**
   * Connected as far as the socket knows, but the server has gone quiet (no ping, or a reveal long overdue): a link
   * that died without closing, as in a tunnel. The socket itself only notices when its ping times out.
   */
  stalled: boolean;
  lobby: LobbyStats | null;
  queue: QueueStatus | null;
  /** The evening Роял's lobby, as the server last said (sent to those in it; the home card loads it too). */
  evening: EveningStatus | null;
  /** Local timestamp the current queue search started (for the stopwatch). */
  queueSince: number;
  room: RoomState | null;
  game: LiveGame | null;
  toasts: Toast[];
  invites: Invite[];
  /** Bumped whenever the server says the friends list changed; pages refetch on change. */
  friendsVersion: number;
  /** The server is restarting for an update (cleared when it's back). */
  maintenance: string | null;
  /** Who asked for a rematch of the match just played (null: nobody yet, or the offer is over). */
  rematch: RematchState | null;
}

export const useStore = create<State>(() => ({
  me: null,
  authChecked: false,
  connected: false,
  stalled: false,
  lobby: null,
  queue: null,
  queueSince: 0,
  evening: null,
  room: null,
  game: null,
  toasts: [],
  invites: [],
  friendsVersion: 0,
  maintenance: null,
  rematch: null,
}));

export const setState = useStore.setState;
export const getState = useStore.getState;

let toastSeq = 0;
/** Shows a toast; the screen that draws it dismisses it after `ttlMs` (see Toasts). */
export function toast(t: Omit<Toast, 'id' | 'ttlMs'>, ttlMs = 4500) {
  const id = ++toastSeq;
  setState((s) => ({
    toasts: [...s.toasts, { ...t, id, ttlMs: t.kind === 'error' ? Math.max(ttlMs, ERROR_TOAST_MS) : ttlMs }],
  }));
}

export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Update the live game if there is one. */
export function patchGame(fn: (g: LiveGame) => Partial<LiveGame>) {
  setState((s) => (s.game ? { game: { ...s.game, ...fn(s.game) } } : {}));
}
