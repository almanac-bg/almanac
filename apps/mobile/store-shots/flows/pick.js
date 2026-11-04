// The question on screen (its label, copied by the flow) → the answer button to tap, as a pattern that tolerates the
// soft hyphens and word joiners the app puts into long words; or the keypad's digits for a number final.
const bare = (s) => s.replace(/[⁠­]/g, '');
const text = bare(String(maestro.copiedText || ''));
const number = text.match(/Въпрос (\d+) от/);
output.n = number ? number[1] : '0';
output.fresh = output.n !== output.last;
output.last = output.n;
const choice = Object.keys(output.A).find((q) => text.includes(bare(q)));
output.ans = choice ? output.A[choice] : null;
const final = output.ans ? undefined : Object.keys(output.N).find((q) => text.includes(bare(q)));
output.num = final ? output.N[final] : null;
output.re = output.ans
  ? `[АБВГ]\\) ${[...output.ans].map((c) => `${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\u2060\\u00ad]*`).join('')}`
  : 'NO_SUCH_ANSWER_XYZ';
for (let i = 0; i < 8; i++) {
  const c = output.num?.[i];
  output[`k${i}`] = c ? (c === ',' ? 'Запетая' : c === '-' ? 'Минус' : c) : '';
}
