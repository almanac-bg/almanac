// What the server sends while playing (internal/play and internal/bank, as JSON).

import type { Tier } from "../ui.ts";

export interface Picture {
  src: string;
  srcset: string;
  w: number;
  h: number;
  alt: string;
}

export interface Credit {
  credit: string;
  license: string;
  licenseUrl?: string;
  source: string;
}

interface ViewBase {
  text: string;
  image?: Picture;
}

export interface ChoiceView extends ViewBase {
  type: "choice";
  choices: string[];
}

export interface NumberView extends ViewBase {
  type: "number";
  unit?: string;
  /** The grid answers are taken on: below 1, the pad has a decimal comma. */
  step: number;
  /** The answer may be below 0 (a temperature): the pad has a minus. */
  signed?: boolean;
}

export interface OrderView extends ViewBase {
  type: "order";
  items: string[];
  direction: "asc" | "desc";
  unit?: string;
}

/** „Вярно или невярно“: the text is the statement. */
export interface TrueFalseView extends ViewBase {
  type: "truefalse";
}

/** „Свържи“: two columns, each in an order of its own. */
export interface MatchView extends ViewBase {
  type: "match";
  left: string[];
  right: string[];
}

export type View = ChoiceView | NumberView | OrderView | TrueFalseView | MatchView;

/** The answer, as the deal showed it, with the fact behind it. */
export interface Reveal {
  /** The question's id: for reporting it. */
  id: string;
  pick?: number;
  value?: number;
  order?: number[];
  values?: number[];
  /** Whether a true/false statement is true. */
  truth?: boolean;
  /** A match's pairs: for each left (as shown), the right that is its pair. */
  pairs?: number[];
  unit?: string;
  fact?: string;
  credit?: Credit;
}

export type Answer =
  | { pick: number }
  | { value: number }
  | { order: number[] }
  | { truth: boolean }
  /** For each left (as shown), the right joined to it, or -1. */
  | { pairs: number[] };

export interface Mark {
  points: number;
  right: boolean;
  partial?: boolean;
}

export interface Shown {
  n: number;
  category: string;
  view: View;
  limitMs: number;
  leftMs: number;
}

export interface State {
  id: number;
  kind: "day" | "topic";
  day?: string;
  category?: string;
  total: number;
  at: number;
  points: number;
  rights: number;
  trail: Mark[];
  question?: Shown;
  done: boolean;
}

export interface Result {
  points: number;
  /** How many of the points were for being quick. */
  speed?: number;
  score: number;
  right: boolean;
  exact?: boolean;
  timedOut?: boolean;
  reveal: Reveal;
  state: State;
}

export interface Reviewed {
  n: number;
  category: string;
  view: View;
  reveal: Reveal;
  given: Answer | null;
  points: number;
  right: boolean;
}

export interface Score {
  name: string;
  /** The player's tag (a link to their profile); none in a room, where guests play by name. */
  tag?: string;
  points: number;
  rights: number;
  ms: number;
  me?: boolean;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
}

export interface Board {
  day: string;
  players: number;
  top: Score[];
  place?: number;
  mine?: Score;
}
