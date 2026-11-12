// What the server sends while playing (internal/play and internal/bank, as JSON).

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
  min: number;
  max: number;
  step: number;
  scale: "linear" | "log";
}

export interface OrderView extends ViewBase {
  type: "order";
  items: string[];
  direction: "asc" | "desc";
  unit?: string;
}

export type View = ChoiceView | NumberView | OrderView;

/** The answer, as the deal showed it, with the fact behind it. */
export interface Reveal {
  /** The question's id: for reporting it. */
  id: string;
  pick?: number;
  value?: number;
  order?: number[];
  values?: number[];
  unit?: string;
  fact?: string;
  credit?: Credit;
}

export type Answer = { pick: number } | { value: number } | { order: number[] };

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
  points: number;
  rights: number;
  ms: number;
  me?: boolean;
}

export interface Board {
  day: string;
  players: number;
  top: Score[];
  place?: number;
  mine?: Score;
}
