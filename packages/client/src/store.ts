import type {
  CategoryId,
  Difficulty,
  GameEndPayload,
  GamePlayer,
  GameStartPayload,
  Invite,
  LobbyStats,
  MeUser,
  PowerupId,
  QuestionPayload,
  QueueStatus,
  RematchState,
  RevealPayload,
  RoomState,
  Standing,
} from '@quiz/shared';
import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  title: string;
  body?: string;
  icon?: string;
}

export type GamePhase = 'countdown' | 'question' | 'reveal' | 'ended';

/** One finished question of the match, for the review afterwards. */
export interface ReviewItem {
  id: string;
  index: number;
  q: string;
  options: string[];
  category: CategoryId;
  difficulty: Difficulty;
  correct: number;
  /** Your pick; null if you didn't answer (or were already out). */
  choice: number | null;
  right: boolean;
  /** "Знаеше ли?" behind the answer, when the question has one. */
  fact: string | null;
}

export interface LiveGame {
  start: GameStartPayload;
  players: Record<string, GamePlayer>;
  standings: Standing[];
  phase: GamePhase;
  countdownEndsAt: number;
  question: QuestionPayload | null;
  /** Local timestamp when the current question closes for you (includes "Още време"). */
  deadline: number;
  /** Extra time "Още време" added to the current question. */
  extraMs: number;
  answered: string[];
  /** Your pick (-1 = locked in before a reconnect, choice unknown). It's in once `answered` includes you. */
  myChoice: number | null;
  removed: number[];
  doubled: boolean;
  usedPowerups: PowerupId[];
  /** A joker was already played on this question (one per question). */
  powerupThisQuestion: boolean;
  /** "Втори шанс" is armed for this question. */
  retryArmed: boolean;
  /** The first pick was wrong and a second one is allowed. */
  retryPrompt: boolean;
  /** Local timestamp until which you're frozen by "Леден удар". */
  frozenUntil: number;
  /** Who froze you, for the overlay. */
  frozenBy: string | null;
  reveal: RevealPayload | null;
  /** Just reconnected: until the server re-sends the question on screen, it may already be closed. */
  resyncing: boolean;
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
  lobby: LobbyStats | null;
  queue: QueueStatus | null;
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
  lobby: null,
  queue: null,
  queueSince: 0,
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
export function toast(t: Omit<Toast, 'id'>, ttlMs = 4500) {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
  setTimeout(() => dismissToast(id), ttlMs);
}

export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Update the live game if there is one. */
export function patchGame(fn: (g: LiveGame) => Partial<LiveGame>) {
  setState((s) => (s.game ? { game: { ...s.game, ...fn(s.game) } } : {}));
}
