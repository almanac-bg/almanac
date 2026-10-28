#!/usr/bin/env node
// The question-bank skill's tool: reads and writes the banks in their one-question-per-line layout, so a diff shows
// exactly the questions that changed. Checks only what it needs to write safely; the rules live in
// apps/server/test/questions.test.ts (run it after every change).
//
//   node .claude/skills/question-bank/bank.mjs stats [bank]           per category: questions by difficulty, facts, next id
//   node .claude/skills/question-bank/bank.mjs show <id>... [--bank b] the questions, one per line
//   node .claude/skills/question-bank/bank.mjs add <file.json> [bank]   appends new questions (an array; a question
//                                                                       without an id gets the next free one)
//   node .claude/skills/question-bank/bank.mjs facts <file.json> [bank] sets fact + factSource ([{id, fact, factSource}])
//   node .claude/skills/question-bank/bank.mjs similar <file.json> [bank]  near-duplicates of the file's questions, in
//                                                                       the bank and within the file (to judge, not proof)
//   node .claude/skills/question-bank/bank.mjs giveaways [file.json] [bank]  questions whose text names another one's
//                                                                       answer (with a file: pairs involving its questions)
//   node .claude/skills/question-bank/bank.mjs fill <file.json> [bank]   adds exactly what balance lacks from checked
//                                                                       candidates; the rest → <file>.spares.json
//   node .claude/skills/question-bank/bank.mjs collect <dir> <out> [slug...]  a workflow's checked batches
//                                                                       (<dir>/<slug>/verified.json) → <out>.json for `add`
//
// bank: "private" (private/questions.json, the default) or "sample" (apps/server/src/data/questions.sample.json).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const BANKS = { private: 'private/questions.json', sample: 'apps/server/src/data/questions.sample.json' };
const PREFIX = {
  general: 'gen',
  science: 'sci',
  history: 'his',
  geography: 'geo',
  movies: 'mov',
  music: 'mus',
  sports: 'spo',
  technology: 'tec',
  literature: 'lit',
  nature: 'nat',
};
// The bank's fields, in the order they're kept (apps/server/src/questions.ts has the schema for each format).
const KEYS = [
  'id',
  'kind',
  'category',
  'difficulty',
  'q',
  'options',
  'answer',
  'number',
  'items',
  'direction',
  'image',
  'fact',
  'factSource',
  'answerSource',
  'tags',
  'added',
  'reviewBy',
];
/** What each format can't do without (`kind` left out: four options). */
const REQUIRED = {
  choice: ['options', 'answer'],
  number: ['number'],
  order: ['items', 'direction'],
};
const DIFFICULTIES = ['easy', 'medium', 'hard'];
/** The mix every match draws (pickQuestions in apps/server/src/questions.ts): the bank keeps the same split. */
const SHARE = { easy: 0.4, medium: 0.4, hard: 0.2 };

function fail(message) {
  console.error(`bank: ${message}`);
  process.exit(1);
}

const kindOf = (q) => q.kind ?? 'choice';
/** A question's answer as text: its right option, or its number as Bulgarian writes it ("6,5"). */
const answerOf = (q) => (kindOf(q) === 'number' ? String(q.number.answer).replace('.', ',') : q.options[q.answer]);

const line = (q) => JSON.stringify(Object.fromEntries(KEYS.filter((k) => q[k] !== undefined).map((k) => [k, q[k]])));
const serialize = (questions) => `[\n${questions.map((q) => `  ${line(q)}`).join(',\n')}\n]\n`;

function load(name = 'private') {
  if (!BANKS[name]) fail(`unknown bank "${name}" (private or sample)`);
  const file = path.join(root, BANKS[name]);
  if (!fs.existsSync(file)) {
    fail(`${BANKS[name]} is missing${name === 'private' ? ': clone almanac-questions into private/ (README)' : ''}`);
  }
  const text = fs.readFileSync(file, 'utf8');
  const questions = JSON.parse(text);
  // Written back in the file's own layout or not at all: a save must never restyle every line.
  if (serialize(questions) !== text) fail(`${BANKS[name]} isn't in the one-question-per-line layout; not touching it`);
  return {
    questions,
    save: () => fs.writeFileSync(file, serialize(questions)),
    where: BANKS[name],
  };
}

function readJson(file) {
  if (!file) fail('which file?');
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!Array.isArray(value)) fail(`${file} must hold an array`);
  return value;
}

const number = (id) => Number(id.split('-')[1]);

/** A non-breaking space between a number and its unit or "г." (2925 м, 1885 г.): a narrow screen never splits them. */
const tidyFact = (fact) =>
  fact.replace(
    /(\d) (?=(?:м|км|см|мм|кг|г\.|т|тона|милиона|милиарда|хиляди|души|години|дни|часа|минути|%|°)(?![\p{L}]))/gu,
    '$1 ',
  );

/** Question words: every other question has them, so they say nothing about two being the same. */
const COMMON = new Set([
  'колко',
  'която',
  'което',
  'които',
  'какво',
  'какъв',
  'каква',
  'какви',
  'годин',
  'чийто',
  'чиято',
  'бълга',
]);

/** Rough word stems (the first five letters of each word of five or more): enough to spot the same question reworded. */
const stems = (text) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 5 || /^\d{3,}$/.test(w))
      .map((w) => w.slice(0, 5))
      .filter((w) => !COMMON.has(w)),
  );

/** Each category's counts, and what it lacks to be balanced: every category the same size, split as a match draws
 * (SHARE), reached by adding only — the smallest such size (a multiple of 5) that no category or difficulty is over.
 * Questions with options only: number questions are balanced on their own (numberBalance). */
function balance(all) {
  const questions = all.filter((q) => kindOf(q) === 'choice');
  const rows = Object.entries(PREFIX).map(([category, prefix]) => {
    const qs = questions.filter((q) => q.category === category);
    const count = Object.fromEntries(DIFFICULTIES.map((d) => [d, qs.filter((q) => q.difficulty === d).length]));
    const next = String(
      Math.max(0, ...all.filter((q) => q.category === category).map((q) => number(q.id))) + 1,
    ).padStart(3, '0');
    return { category, total: qs.length, count, facts: qs.filter((q) => q.fact).length, next: `${prefix}-${next}` };
  });
  const size =
    Math.ceil(
      Math.max(...rows.flatMap((r) => [r.total, ...DIFFICULTIES.map((d) => r.count[d] / SHARE[d])])) / 5 - 1e-9,
    ) * 5;
  const target = { easy: size * SHARE.easy, medium: size * SHARE.medium, hard: size * SHARE.hard };
  for (const r of rows)
    r.short = Object.fromEntries(DIFFICULTIES.map((d) => [d, Math.max(0, Math.round(target[d] - r.count[d]))]));
  return { rows, size, target };
}

/**
 * Number questions (a match's final, one a match): every category the same number of them; the difficulty split
 * doesn't apply, since a final is drawn from any difficulty.
 */
function numberBalance(questions) {
  const counts = Object.keys(PREFIX).map((category) => ({
    category,
    total: questions.filter((q) => kindOf(q) === 'number' && q.category === category).length,
  }));
  const size = Math.max(...counts.map((c) => c.total));
  return { counts, size };
}

/** Appends new questions: checked fields, the next free id where there is none, facts tidied, the bank's key order. */
function append(bank, added) {
  const taken = new Set(bank.questions.map((q) => q.id));
  // Never a removed question's id (reports and stats refer to ids): new ones continue after the highest.
  const next = {};
  for (const q of bank.questions) next[q.category] = Math.max(next[q.category] ?? 0, number(q.id));
  for (const q of added) {
    const required = REQUIRED[q.kind ?? 'choice'];
    if (!required) fail(`${q.id ?? q.q}: unknown kind ${q.kind}`);
    const missing = ['category', 'difficulty', 'q', ...required].filter((k) => q[k] === undefined);
    if (missing.length) fail(`${q.id ?? q.q ?? JSON.stringify(q).slice(0, 60)}: missing ${missing.join(', ')}`);
    if (!PREFIX[q.category]) fail(`${q.q}: unknown category ${q.category}`);
    const unknown = Object.keys(q).filter((k) => !KEYS.includes(k));
    if (unknown.length) fail(`${q.id ?? q.q}: unknown fields ${unknown.join(', ')}`);
    if (q.id === undefined) {
      next[q.category] = (next[q.category] ?? 0) + 1;
      q.id = `${PREFIX[q.category]}-${String(next[q.category]).padStart(3, '0')}`;
    }
    if (!q.id.startsWith(`${PREFIX[q.category]}-`)) fail(`${q.id}: the id doesn't match the category ${q.category}`);
    if (taken.has(q.id)) fail(`${q.id} is taken (leave the id out to get the next free one)`);
    if (q.fact) q.fact = tidyFact(q.fact);
    taken.add(q.id);
    bank.questions.push(Object.fromEntries(KEYS.filter((k) => q[k] !== undefined).map((k) => [k, q[k]])));
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'stats': {
    const { questions, where } = load(args[0]);
    console.log(`${where}: ${questions.length} questions, ${questions.filter((q) => q.fact).length} with a fact`);
    const { rows, size, target } = balance(questions);
    for (const r of rows) {
      const short = DIFFICULTIES.map((d) => [d, r.short[d]]).filter(([, n]) => n > 0);
      console.log(
        `${r.category.padEnd(11)} ${String(r.total).padStart(4)}  easy ${r.count.easy} · medium ${r.count.medium} · hard ${r.count.hard}  facts ${r.facts}  next ${r.next}${short.length ? `  to balance: ${short.map(([d, n]) => `+${n} ${d}`).join(', ')}` : ''}`,
      );
    }
    const missing = rows.reduce((sum, r) => sum + size - r.total, 0);
    console.log(
      `balanced: ${size} per category (${target.easy}/${target.medium}/${target.hard}), ${missing ? `${missing} questions to add` : 'reached'}`,
    );
    const numbers = numberBalance(questions);
    if (numbers.size) {
      console.log(
        `number questions (finals): ${numbers.counts.map((c) => `${c.category} ${c.total}${c.total < numbers.size ? ` (+${numbers.size - c.total})` : ''}`).join(' · ')}`,
      );
    }
    break;
  }
  case 'show': {
    const at = args.indexOf('--bank');
    const { questions } = load(at >= 0 ? args[at + 1] : undefined);
    const ids = at >= 0 ? args.filter((_, i) => i !== at && i !== at + 1) : args;
    for (const id of ids) {
      const q = questions.find((x) => x.id === id);
      console.log(q ? line(q) : `${id}: not in this bank`);
    }
    break;
  }
  case 'add': {
    const added = readJson(args[0]);
    const bank = load(args[1]);
    append(bank, added);
    bank.save();
    console.log(`${bank.where}: added ${added.length}; now ${bank.questions.length}`);
    break;
  }
  case 'fill': {
    // Checked candidates (e.g. collect's .tids.json, written with a spare or two per difficulty) → exactly what each
    // category and difficulty lacks for balance, in the file's order; the rest wait in <file>.spares.json.
    const candidates = readJson(args[0]);
    if (candidates.some((q) => kindOf(q) !== 'choice')) fail('fill takes questions with options only');
    const bank = load(args[1]);
    const { rows } = balance(bank.questions);
    const lacking = Object.fromEntries(rows.map((r) => [r.category, { ...r.short }]));
    const picked = [];
    const spares = [];
    for (const q of candidates) {
      const left = lacking[q.category];
      if (left && left[q.difficulty] > 0) {
        left[q.difficulty]--;
        picked.push(Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'tid')));
      } else spares.push(q);
    }
    append(bank, picked);
    bank.save();
    const spareFile = args[0].replace(/(\.tids)?\.json$/, '.spares.json');
    fs.writeFileSync(spareFile, JSON.stringify(spares, null, 1));
    const still = Object.entries(lacking).flatMap(([c, l]) =>
      DIFFICULTIES.filter((d) => l[d] > 0).map((d) => `${c} +${l[d]} ${d}`),
    );
    console.log(
      `${bank.where}: added ${picked.length}; now ${bank.questions.length}. ${spares.length} spares → ${spareFile}`,
    );
    console.log(still.length ? `still lacking: ${still.join(', ')}` : 'balanced');
    break;
  }
  case 'facts': {
    const facts = readJson(args[0]);
    const bank = load(args[1]);
    const missing = [];
    for (const f of facts) {
      if (!f.fact || !f.factSource) fail(`${f.id}: needs both fact and factSource`);
      const q = bank.questions.find((x) => x.id === f.id);
      if (!q) {
        missing.push(f.id);
        continue;
      }
      q.fact = tidyFact(f.fact);
      q.factSource = f.factSource;
    }
    bank.save();
    console.log(
      `${bank.where}: ${facts.length - missing.length} facts set${missing.length ? `; not in this bank: ${missing.join(' ')}` : ''}`,
    );
    break;
  }
  case 'similar': {
    const drafts = readJson(args[0]);
    const { questions } = load(args[1]);
    const label = (q, i) => q.id ?? q.tid ?? `#${i + 1}`;
    const keyed = (q) => ({
      q,
      words: stems(`${q.q} ${answerOf(q)}`),
      answer: answerOf(q).toLowerCase(),
    });
    const bank = questions.map(keyed);
    const mine = drafts.map(keyed);
    let found = 0;
    mine.forEach((d, i) => {
      const others = [
        ...bank.map((b) => ({ ...b, where: b.q.id })),
        ...mine.slice(i + 1).map((b, j) => ({ ...b, where: label(b.q, i + 1 + j) })),
      ];
      for (const o of others) {
        const shared = [...d.words].filter((w) => o.words.has(w));
        const overlap = shared.length / Math.max(1, Math.min(d.words.size, o.words.size));
        // The same answer with a shared key word, or most of the words in common.
        if ((d.answer === o.answer && shared.length >= 1) || (shared.length >= 2 && overlap >= 0.6)) {
          found++;
          console.log(`${label(d.q, i)}: ${d.q.q} → ${answerOf(d.q)}`);
          console.log(`  ~ ${o.where}: ${o.q.q} → ${answerOf(o.q)}  (shared: ${shared.join(' ')})`);
        }
      }
    });
    console.log(found ? `${found} pairs to judge` : 'nothing similar');
    break;
  }
  case 'giveaways': {
    // In one match (Микс takes every category), a question whose text names another's answer, on the same subject,
    // gives it away. The same answer alone isn't enough ("България" is in hundreds), hence the shared key words. A
    // number (a year) is given away by a fact too, shown after an earlier question, and one shared word is enough.
    const extra = args[0]?.endsWith('.json') ? readJson(args[0]) : [];
    const { questions } = load(args[0]?.endsWith('.json') ? args[1] : args[0]);
    const all = [...questions, ...extra.map((q, i) => ({ ...q, id: q.id ?? q.tid ?? `#${i + 1}` }))];
    const mine = new Set(extra.length ? all.slice(questions.length) : all);
    const norm = (s) =>
      ` ${s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()} `;
    const texts = all.map((q) => ({
      q,
      text: norm(q.q),
      withFact: norm(`${q.q} ${q.fact ?? ''}`),
      words: stems(q.q),
      factWords: stems(`${q.q} ${q.fact ?? ''}`),
    }));
    let found = 0;
    for (const a of all) {
      const isNumber = kindOf(a) === 'number';
      const answer = norm(answerOf(a));
      if (answer.trim().length < (isNumber ? 2 : 4)) continue;
      const words = stems(a.q);
      for (const b of texts) {
        if (b.q === a || !(mine.has(a) || mine.has(b.q))) continue;
        if (!(isNumber ? b.withFact : b.text).includes(answer)) continue;
        const shared = [...words].filter((w) => (isNumber ? b.factWords : b.words).has(w));
        if (shared.length < (isNumber ? 1 : 2)) continue;
        found++;
        console.log(`${b.q.id} names the answer of ${a.id} («${answerOf(a)}»)`);
        console.log(`  ${a.id}: ${a.q}\n  ${b.q.id}: ${b.q.q}${isNumber && b.q.fact ? ` [${b.q.fact}]` : ''}`);
      }
    }
    console.log(found ? `${found} pairs to judge` : 'no giveaways');
    break;
  }
  case 'collect': {
    // A workflow's batches, as the checker left them: OK and FIX go in, DROP doesn't; anything malformed is listed.
    const [dir, out, ...only] = args;
    if (!dir || !out) fail('collect <dir> <out> [slug...]');
    const slugs = only.length
      ? only
      : fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'verified.json')));
    const kept = [];
    for (const slug of slugs) {
      const items = readJson(path.join(dir, slug, 'verified.json'));
      const tally = { OK: 0, FIX: 0, DROP: 0 };
      for (const item of items) {
        tally[item.verdict] = (tally[item.verdict] ?? 0) + 1;
        if (item.verdict !== 'OK' && item.verdict !== 'FIX') continue;
        const q = Object.fromEntries(KEYS.filter((k) => k !== 'id' && item[k] != null).map((k) => [k, item[k]]));
        const bad = [
          !PREFIX[q.category] && 'category',
          !DIFFICULTIES.includes(q.difficulty) && 'difficulty',
          !(q.q?.trim().length >= 10 && q.q.length <= 150 && /[?“]$/.test(q.q)) && 'question',
          !(q.options?.length === 4 && q.options.every((o) => o.trim() && o.length <= 45)) && 'options',
          !(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3) && 'answer',
          q.fact && !(q.fact.trim().length >= 20 && q.fact.length <= 200 && /[.!?…“"]$/.test(q.fact)) && 'fact',
          q.fact && !q.factSource?.startsWith('https://') && 'factSource',
        ].filter(Boolean);
        if (bad.length) console.log(`  left out ${item.tid}: ${bad.join(', ')}`);
        else kept.push({ tid: item.tid, ...q });
      }
      console.log(`${slug.padEnd(34)} OK ${tally.OK}  FIX ${tally.FIX}  DROP ${tally.DROP}`);
    }
    // Options are shuffled in every match anyway; spreading the stored positions keeps the bank's position test honest.
    kept.forEach((q, i) => {
      const shift = (q.answer - (i % 4) + 4) % 4;
      q.options = [...q.options.slice(shift), ...q.options.slice(0, shift)];
      q.answer = i % 4;
    });
    fs.writeFileSync(`${out}.tids.json`, JSON.stringify(kept, null, 1));
    fs.writeFileSync(
      `${out}.json`,
      JSON.stringify(
        kept.map(({ tid, ...q }) => q),
        null,
        1,
      ),
    );
    console.log(`${kept.length} kept → ${out}.json (with tids: ${out}.tids.json, for similar and giveaways)`);
    break;
  }
  default:
    fail('commands: stats · show · add · fill · facts · similar · giveaways · collect (see the top of this file)');
}
