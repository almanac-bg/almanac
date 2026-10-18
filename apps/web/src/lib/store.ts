import type {
  GameEndPayload,
  GamePlayer,
  GameStartPayload,
  Invite,
  LobbyStats,
  MeUser,
  PowerupId,
  QuestionPayload,
  QueueStatus,
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

export interface LiveGame {
  start: GameStartPayload;
  players: Record<string, GamePlayer>;
  standings: Standing[];
  phase: GamePhase;
  countdownEndsAt: number;
  question: QuestionPayload | null;
  /** Local timestamp when the current question closes for you (includes "Още време"). */
  deadline: number;
  answered: string[];
  /** -1 = locked in before a reconnect, choice unknown. */
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
  eliminated: string[];
  reactions: { key: number; playerId: string; emote: string }[];
  feed: { key: number; text: string; icon: string }[];
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
