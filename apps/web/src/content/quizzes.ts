import { use } from 'react';
import { reloadForNewVersion } from '../lib/reload';
import { choiceQuestions, type QuizQuestion } from './choice';

export type { QuizQuestion } from './choice';

/**
 * Each public quiz's questions, a file of its own: a page downloads only the quiz it shows, and the hub and the guides
 * none (the 31 October review, WEB-7). The holidays' by their slug, and the public sample (the same file is in the
 * open-source repository: the real bank never leaves the server).
 */
const FILES: Record<string, () => Promise<readonly unknown[]>> = {
  sample: () => import('../../../server/src/data/questions.sample.json').then((m) => m.default),
  ...Object.fromEntries(
    Object.entries(import.meta.glob<readonly unknown[]>('./*.json', { import: 'default' })).map(([file, load]) => [
      file.slice('./'.length, -'.json'.length),
      load,
    ]),
  ),
};

/** The quizzes that have arrived, read at once; and those on their way, shared by everyone who asks. */
const loaded = new Map<string, QuizQuestion[]>();
const loading = new Map<string, Promise<QuizQuestion[]>>();

/** A quiz's questions, fetched once. One that didn't arrive (an older build's file, after a deploy) is a reload away. */
export function loadQuiz(id: string): Promise<QuizQuestion[]> {
  const file = FILES[id];
  if (!file) return Promise.reject(new Error(`No quiz "${id}"`));
  let questions = loading.get(id);
  if (!questions) {
    questions = file().then(
      (list) => {
        const choice = choiceQuestions(list);
        loaded.set(id, choice);
        return choice;
      },
      (err: unknown) => {
        loading.delete(id); // to be asked for again
        reloadForNewVersion();
        throw err;
      },
    );
    loading.set(id, questions);
  }
  return questions;
}

/**
 * A quiz's questions on its page: at once when they're here (a drawn page is hydrated with them, pages/lazy.ts →
 * preloadPage), otherwise the page waits for them (a move from the hub keeps the hub on screen meanwhile).
 */
export function useQuiz(id: string | null): QuizQuestion[] {
  if (!id) return [];
  return loaded.get(id) ?? use(loadQuiz(id));
}
