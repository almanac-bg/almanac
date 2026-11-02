/** A public quiz's question as its page shows it: four options, the right one, and the fact after it. */
export interface QuizQuestion {
  id: string;
  /** A sample question's category (a holiday's questions are all the holiday's). */
  category?: string;
  q: string;
  options: string[];
  answer: number;
  fact?: string;
  factSource?: string;
}

interface AnyQuestion extends Partial<QuizQuestion> {
  kind?: string;
  image?: unknown;
}

/**
 * The plain four-option questions of a quiz file: the pages show those (pictures need the game's own files; numbers and
 * orders its screens). Plain code, no app imports: the build counts each quiz with it too (vite.quizzes.ts).
 */
export function choiceQuestions(list: readonly unknown[]): QuizQuestion[] {
  return (list as AnyQuestion[]).filter(
    (q): q is QuizQuestion => (q.kind ?? 'choice') === 'choice' && !q.image && !!q.options && q.answer !== undefined,
  );
}
