// Relative imports: the config is loaded by Node, which can't resolve the shared package's TS sources.

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { choiceQuestions } from './src/content/choice.ts';

const ID = 'virtual:quiz-counts';

/**
 * How many questions each public quiz shows, counted from its file as the build runs (`virtual:quiz-counts`): the hub
 * lists every quiz with its count without downloading any of them (src/content/quizzes.ts), and a count can't drift
 * from its file. A category's from the public sample, a holiday's by its slug.
 */
export function quizCounts(): Plugin {
  const content = path.resolve(import.meta.dirname, 'src/content');
  const sample = path.resolve(import.meta.dirname, '../server/src/data/questions.sample.json');
  const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[];
  return {
    name: 'quiz-counts',
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return;
      const counts: Record<string, number> = {};
      for (const q of choiceQuestions(read(sample))) {
        const category = q.category ?? '';
        counts[category] = (counts[category] ?? 0) + 1;
      }
      for (const file of fs.readdirSync(content).filter((f) => f.endsWith('.json'))) {
        counts[file.slice(0, -'.json'.length)] = choiceQuestions(read(path.join(content, file))).length;
        this.addWatchFile(path.join(content, file));
      }
      this.addWatchFile(sample);
      return `export const QUIZ_COUNTS = ${JSON.stringify(counts)};`;
    },
  };
}
