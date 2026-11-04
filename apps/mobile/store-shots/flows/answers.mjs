// The answer map the flows play right with (pick.js): every four-option question's text → its answer, and every
// number final's → the digits to type, from the private bank. Written to answers.js beside it, which git ignores:
// the bank's answers never go in the public repository.
//
//   node apps/mobile/store-shots/flows/answers.mjs [path/to/questions.json]
import fs from 'node:fs';
import path from 'node:path';

const bank = process.argv[2] ?? path.resolve(import.meta.dirname, '../../../../private/questions.json');
const questions = JSON.parse(fs.readFileSync(bank, 'utf8'));
const A = {};
const N = {};
for (const q of questions) {
  if (!q.kind && Array.isArray(q.options) && typeof q.answer === 'number') A[q.q] = q.options[q.answer];
  if (q.kind === 'number') N[q.q] = String(q.number.answer).replace('.', ',');
}
fs.writeFileSync(
  path.join(import.meta.dirname, 'answers.js'),
  `output.A = ${JSON.stringify(A)};\noutput.N = ${JSON.stringify(N)};\noutput.last = 0;\n`,
);
console.log(`answers.js: ${Object.keys(A).length} answers, ${Object.keys(N).length} finals`);
