declare module 'virtual:quiz-counts' {
  /** How many questions each public quiz shows: a category's (from the public sample) or a holiday's, by its slug. */
  export const QUIZ_COUNTS: Record<string, number>;
}
