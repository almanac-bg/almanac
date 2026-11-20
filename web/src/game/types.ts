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
  /** The options' names; none when the options are pictures (the names show with the answer). */
  choices?: string[];
  /** The options as pictures (a flag, a painting). */
  pictures?: Picture[];
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

/** „Раздели“: six things, one by one, each sent to one of two groups. */
export interface SplitView extends ViewBase {
  type: "split";
  groups: [string, string];
  items: string[];
}

/** „Подсказки“: the clues out so far (the server sends each as its time comes), and four options from the start. */
export interface CluesView extends ViewBase {
  type: "clues";
  clues: string[];
  total: number;
  /** When each clue shows, from when the question does. */
  stepsMs: number[];
  /** How long the question had shown when this view was made. */
  sinceMs: number;
  choices: string[];
}

export type View = ChoiceView | NumberView | OrderView | TrueFalseView | MatchView | SplitView | CluesView;

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
  /** Where a match's decoy is shown: the right that is no left's pair. */
  decoy?: number;
  /** A split's groups: for each item (as shown), the group it belongs to. */
  sides?: number[];
  /** All the clues of a clues question. */
  clues?: string[];
  /** A choice of pictures: its options' names and its pictures' credits, as shown. */
  names?: string[];
  credits?: Credit[];
  unit?: string;
  /** A question of the day's ten dealt on its date („На този ден“): what happened that day. */
  day?: string;
  fact?: string;
  credit?: Credit;
  /** How players have answered the question so far (none until it has enough answers). */
  crowd?: Crowd;
}

/** How players have answered a question: how many answers, the share right, and per kind more. */
export interface Crowd {
  answers: number;
  right: number;
  /** A choice's share of picks for each option (as shown); a true-or-not's for true, then false. */
  picks?: number[];
  /** Where a number's typed guesses fell. */
  guesses?: Spread;
  /** A question of the day's ten: its players today, not everyone ever. */
  today?: boolean;
}

/** Typed guesses around a number's answer: equal parts of lo–hi (on a log scale if log), and the shares beyond. */
export interface Spread {
  lo: number;
  hi: number;
  log?: boolean;
  bins: number[];
  below: number;
  above: number;
}

export type Answer =
  | { pick: number }
  | { value: number }
  | { order: number[] }
  | { truth: boolean }
  /** For each left (as shown), the right joined to it, or -1. */
  | { pairs: number[] }
  /** For each item (as shown), the group it was sent to, or -1. */
  | { sides: number[] };

export interface Mark {
  right: boolean;
  /** Close („близо“): worth something, not right; it counts as not right (play.Mark.Close). */
  close?: boolean;
  /** A question of the day that counts for nobody: found wrong, or changed, during its day (play/day.go). */
  void?: boolean;
}

export interface Shown {
  n: number;
  category: string;
  view: View;
  limitMs: number;
  leftMs: number;
  /** How soon more of the question shows (its next clue): look again then. */
  moreMs?: number;
  /** How soon its time starts by itself, while it waits for its pictures: the screen starts it once they're in. */
  startsMs?: number;
  /** A day's question that belongs to its date: „На този ден“ beside its topic. */
  onThisDay?: boolean;
}

export interface State {
  id: number;
  kind: "day" | "topic";
  day?: string;
  category?: string;
  total: number;
  /** How many of the `total` count for nobody (Mark.void): the game is of `total − void` questions. */
  void?: number;
  at: number;
  rights: number;
  trail: Mark[];
  question?: Shown;
  done: boolean;
  /** In a duel played second, how the other side's answers went as far as the player has come (play.State.Against):
   * each question answered; of the one shown, only when they answered it (`ms`), if they did. */
  against?: TheirMark[];
}

/** How a question of a duel went for the other side (play.DuelMark), as the player's run has it. */
export interface TheirMark {
  right?: boolean;
  close?: boolean;
  missed?: boolean;
  ms: number;
}

export interface Result {
  /** How many right answers in a row the answer makes, from 2: the climb's feel, worth nothing more. */
  inRow?: number;
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
  right: boolean;
  close?: boolean;
  /** An answer to a question that counts for nobody (Mark.void): in no score. */
  void?: boolean;
}

export interface Score {
  name: string;
  /** The player's tag: a link to their profile. */
  tag?: string;
  rights: number;
  /** How many questions `rights` is out of: the day's that count (ten, but for one that counts for nobody). */
  of: number;
  ms: number;
  me?: boolean;
  avatar?: string;
  /** How each of the ten went: on the friends' board, once the viewer has finished the day. */
  trail?: Mark[];
}

export interface Board {
  day: string;
  players: number;
  /** How many of the day's questions count (ten, but for one that counts for nobody): what `average` is out of. */
  of: number;
  top: Score[];
  place?: number;
  mine?: Score;
  /** The day's right answers on average, once ten have played it. */
  average?: number;
  /** How many played the day to each count of right answers, 0 to `of`, once ten have (people only). */
  spread?: number[];
}
