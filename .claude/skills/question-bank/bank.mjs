#!/usr/bin/env node
// The question-bank skill's tool: reads and writes the banks in their one-question-per-line layout, so a diff shows
// exactly the questions that changed. Checks only what it needs to write safely; the rules live in
// apps/server/test/questions.test.ts (run it after every change).
//
//   node .claude/skills/question-bank/bank.mjs stats [bank]           per category: questions by difficulty, facts, next id
//   node .claude/skills/question-bank/bank.mjs show <id>... [--bank b] the questions, one per line
//   node .claude/skills/question-bank/bank.mjs add <file.json> [bank]   appends new questions (an array, ids not taken yet)
//   node .claude/skills/question-bank/bank.mjs facts <file.json> [bank] sets fact + factSource ([{id, fact, factSource}])
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
const KEYS = ['id', 'category', 'difficulty', 'q', 'options', 'answer', 'fact', 'factSource'];

function fail(message) {
  console.error(`bank: ${message}`);
  process.exit(1);
}

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

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'stats': {
    const { questions, where } = load(args[0]);
    console.log(`${where}: ${questions.length} questions, ${questions.filter((q) => q.fact).length} with a fact`);
    for (const [category, prefix] of Object.entries(PREFIX)) {
      const qs = questions.filter((q) => q.category === category);
      const by = (d) => qs.filter((q) => q.difficulty === d).length;
      const next = String(Math.max(0, ...qs.map((q) => number(q.id))) + 1).padStart(3, '0');
      const facts = qs.filter((q) => q.fact).length;
      console.log(
        `${category.padEnd(11)} ${String(qs.length).padStart(4)}  easy ${by('easy')} · medium ${by('medium')} · hard ${by('hard')}  facts ${facts}  next ${prefix}-${next}`,
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
    const taken = new Set(bank.questions.map((q) => q.id));
    for (const q of added) {
      const missing = ['id', 'category', 'difficulty', 'q', 'options', 'answer'].filter((k) => q[k] === undefined);
      if (missing.length) fail(`${q.id ?? JSON.stringify(q).slice(0, 60)}: missing ${missing.join(', ')}`);
      const unknown = Object.keys(q).filter((k) => !KEYS.includes(k));
      if (unknown.length) fail(`${q.id}: unknown fields ${unknown.join(', ')}`);
      if (!q.id.startsWith(`${PREFIX[q.category]}-`)) fail(`${q.id}: the id doesn't match the category ${q.category}`);
      if (taken.has(q.id)) fail(`${q.id} is taken (see "stats" for the next free id)`);
      taken.add(q.id);
      bank.questions.push(q);
    }
    bank.save();
    console.log(`${bank.where}: added ${added.length}; now ${bank.questions.length}`);
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
      q.fact = f.fact;
      q.factSource = f.factSource;
    }
    bank.save();
    console.log(
      `${bank.where}: ${facts.length - missing.length} facts set${missing.length ? `; not in this bank: ${missing.join(' ')}` : ''}`,
    );
    break;
  }
  default:
    fail('commands: stats [bank] · show <id>... [--bank b] · add <file.json> [bank] · facts <file.json> [bank]');
}
