import { createHash, randomBytes } from 'node:crypto';
import {
  dayKey,
  type QuestionSetInfo,
  type QuestionSetSummary,
  type RoomSettings,
  SETS,
  type SetImage,
  type SetQuestion,
  type SharedSetPreview,
  setPictureUrl,
} from '@quiz/shared';
import { z } from 'zod';
import { all, one, run, tx } from './db';
import { logAction } from './modlog';
import { textProblem } from './names';
import type { HostImage, PreparedQuestion } from './questions';
import { shuffle } from './questions';
import { count } from './stats';

/**
 * „Моите въпроси“: a host's own question sets (SETS), for their private rooms — a teacher's quiz on the lesson, an
 * office's on the year. Never in the bank: they're played only where their owner hosts (or whoever took a copy from
 * the share link), and a match on one says nothing about anyone's knowledge (see the rewards).
 */

interface SetRow {
  id: number;
  owner_id: number;
  name: string;
  code: string;
  questions: string;
  hidden: number;
  copied_from: number | null;
  created_at: number;
  updated_at: number;
}

/** Text as typed, tidied: one space between words. */
const text = (min: number, max: number, what: string) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').replace(/\s+/gu, ' ').trim())
    .pipe(z.string().min(min, `${what}: поне ${min} знака.`).max(max, `${what}: най-много ${max} знака.`));

const QuestionText = text(SETS.question[0], SETS.question[1], 'Въпросът');
const Unit = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(SETS.unit, `Мерната единица е до ${SETS.unit} знака.`));
const Amount = z.number().finite().min(-1e12).max(1e12);

/** A picture as a question holds it: its size and what it shows are checked against the upload when it's saved. */
const ImageRef = z
  .object({
    id: z.string().regex(/^[0-9a-f]{16}$/),
    w: z.number().int(),
    h: z.number().int(),
    alt: z
      .string()
      .transform((s) => s.normalize('NFC').replace(/\s+/gu, ' ').trim())
      .pipe(z.string().max(SETS.imageAlt, `Описанието на снимката е до ${SETS.imageAlt} знака.`)),
  })
  .optional();

/** Values for all four or none; given, they go up or down in the order the host put them. */
const inOrder = (values: (number | null)[]) => {
  if (values.every((v) => v === null)) return true;
  if (values.some((v) => v === null)) return false;
  const v = values as number[];
  const up = v.every((x, i) => i === 0 || x > v[i - 1]);
  const down = v.every((x, i) => i === 0 || x < v[i - 1]);
  return up || down;
};

const SetQuestionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('choice'),
      q: QuestionText,
      options: z.array(text(SETS.option[0], SETS.option[1], 'Отговорът')).length(4, 'Въпросът иска четири отговора.'),
      answer: z.number().int().min(0).max(3),
      image: ImageRef,
    })
    .refine((q) => new Set(q.options.map((o) => o.toLocaleLowerCase('bg'))).size === 4, {
      message: 'Двата отговора на един въпрос са еднакви.',
    }),
  z.object({ kind: z.literal('truefalse'), q: QuestionText, answer: z.boolean(), image: ImageRef }),
  z.object({
    kind: z.literal('number'),
    q: QuestionText,
    number: z.object({
      answer: Amount,
      unit: Unit,
      tolerance: z.number().finite().positive('Отклонението трябва да е над нула.').max(1e12),
    }),
  }),
  z
    .object({
      kind: z.literal('order'),
      q: QuestionText,
      items: z
        .array(z.object({ text: text(SETS.option[0], SETS.option[1], 'Всяко от четирите'), value: Amount.nullable() }))
        .length(4, 'За подреждане трябват четири неща.'),
      unit: Unit,
    })
    .refine((q) => new Set(q.items.map((i) => i.text.toLocaleLowerCase('bg'))).size === 4, {
      message: 'Две от нещата за подреждане са еднакви.',
    })
    .refine((q) => inOrder(q.items.map((i) => i.value)), {
      message:
        'Числата трябва да са дадени за всичките четири (или за нито едно) и да растат или намаляват по реда им.',
    }),
]);

export const SetSchema = z.object({
  // Shown to whoever has its link, and on the room's big screen.
  name: text(SETS.name[0], SETS.name[1], 'Името').superRefine((name, ctx) => {
    const problem = textProblem(name, 'Името на набора');
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  }),
  questions: z.array(SetQuestionSchema).max(SETS.maxQuestions, `Най-много ${SETS.maxQuestions} въпроса.`),
});

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const newCode = () => randomBytes(6).toString('base64url');
const questionsOf = (row: SetRow) => JSON.parse(row.questions) as SetQuestion[];
const getRow = (id: number) => one<SetRow>('SELECT * FROM question_sets WHERE id = ?', id);
const owned = (id: number, userId: number) => {
  const row = getRow(id);
  return row && row.owner_id === userId ? row : undefined;
};

// ─── Pictures ───────────────────────────────────────────────────────────────

/**
 * A picture as uploaded: what it is and its size, read from the file itself (a WebP or a JPEG, as a browser's canvas
 * makes them: nothing animated). Null for anything else, or a file cut short. The editor makes them small enough
 * itself (SETS.imageSide, SETS.imageBytes): the server only checks.
 */
export function readPicture(b: Buffer): { type: 'image/webp' | 'image/jpeg'; w: number; h: number } | null {
  const size = b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' ? webpSize(b) : jpegSize(b);
  if (!size) return null;
  const { w, h } = size;
  if (w < 16 || h < 16 || w > SETS.imageSide || h > SETS.imageSide) return null;
  return { type: b[0] === 0xff ? 'image/jpeg' : 'image/webp', w, h };
}

function webpSize(b: Buffer): { w: number; h: number } | null {
  if (b.toString('latin1', 8, 12) !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  // Extended: only a still picture without EXIF or XMP (a canvas makes none; a phone's photo might say where it was).
  if (chunk === 'VP8X') {
    if (b[20] & (0x02 | 0x04 | 0x08)) return null;
    return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function jpegSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9)
    return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // EXIF and the like (APP1–APP15): a canvas writes none, and a photo's could say where it was taken.
    if (marker >= 0xe1 && marker <= 0xef) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** A picture's id: a hash of its content (the same picture twice is one). */
const pictureId = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);

/** Keeps a picture a host uploads for a question of theirs, up to SETS.images of them. */
export function uploadPicture(userId: number, bytes: Buffer): Result<{ id: string; w: number; h: number }> {
  if (bytes.length > SETS.imageBytes) return { ok: false, error: 'Снимката е твърде голяма.' };
  const pic = readPicture(bytes);
  if (!pic) return { ok: false, error: 'Това не е снимка, която можем да ползваме (WebP или JPEG).' };
  const id = pictureId(bytes);
  if (one('SELECT 1 AS x FROM set_images WHERE owner_id = ? AND id = ?', userId, id))
    return { ok: true, id, w: pic.w, h: pic.h };
  const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM set_images WHERE owner_id = ?', userId)!.n;
  if (count >= SETS.images)
    return { ok: false, error: `Можеш да пазиш до ${SETS.images} снимки — махни някоя от наборите си.` };
  run(
    'INSERT INTO set_images (owner_id, id, type, bytes, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    id,
    pic.type,
    bytes,
    pic.w,
    pic.h,
    Date.now(),
  );
  return { ok: true, id, w: pic.w, h: pic.h };
}

/** A picture to serve: none once a moderator has blocked it (or no set has kept it). */
export const pictureFile = (id: string) =>
  one<{ type: string; bytes: Uint8Array }>(
    'SELECT type, bytes FROM set_images WHERE id = ? AND blocked = 0 LIMIT 1',
    id,
  );

/** The pictures (by id) there are to play, with their real size. */
function picturesOf(ids: string[]): Map<string, { w: number; h: number }> {
  if (!ids.length) return new Map();
  return new Map(
    all<{ id: string; w: number; h: number }>(
      `SELECT id, MAX(w) AS w, MAX(h) AS h FROM set_images WHERE blocked = 0 AND id IN (${ids.map(() => '?').join(',')})
       GROUP BY id`,
      ...ids,
    ).map((r) => [r.id, { w: r.w, h: r.h }]),
  );
}

const imageIds = (questions: SetQuestion[]) => questions.flatMap((q) => ('image' in q && q.image ? [q.image.id] : []));

/**
 * A set's questions as they're kept: each picture's size as uploaded. Null (with which question) when a picture isn't
 * there to use: never uploaded, or blocked.
 */
function withPictures(questions: SetQuestion[]): Result<{ questions: SetQuestion[] }> {
  const known = picturesOf(imageIds(questions));
  const out: SetQuestion[] = [];
  for (const [i, q] of questions.entries()) {
    if (!('image' in q) || !q.image) {
      out.push(q);
      continue;
    }
    const size = known.get(q.image.id);
    if (!size) return { ok: false, error: `Въпрос ${i + 1}: снимката я няма — сложи я отново.` };
    out.push({ ...q, image: { ...q.image, ...size } });
  }
  return { ok: true, questions: out };
}

/**
 * Pictures no set has used for a day go (an upload left behind by an editor closed before saving, a question changed
 * since): `SETS.images` is about what a host keeps, not what they ever tried. It reads every set, so it runs once a
 * day (the upkeep's first run of the day). Returns how many went.
 */
export function sweepPictures(now = Date.now()): number {
  const today = dayKey(now);
  if (one("SELECT 1 AS x FROM settings WHERE key = 'pictures_swept' AND value = ?", today)) return 0;
  run(
    "INSERT INTO settings (key, value) VALUES ('pictures_swept', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    today,
  );
  const used = new Set(
    all<{ id: string }>(
      `SELECT DISTINCT json_extract(q.value, '$.image.id') AS id FROM question_sets s, json_each(s.questions) q
       WHERE json_extract(q.value, '$.image.id') IS NOT NULL`,
    ).map((r) => r.id),
  );
  let swept = 0;
  tx(() => {
    for (const r of all<{ owner_id: number; id: string }>(
      'SELECT owner_id, id FROM set_images WHERE created_at < ?',
      now - 24 * 60 * 60_000,
    )) {
      if (used.has(r.id)) continue;
      run('DELETE FROM set_images WHERE owner_id = ? AND id = ?', r.owner_id, r.id);
      swept++;
    }
  });
  return swept;
}

function info(row: SetRow): QuestionSetInfo {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    questions: questionsOf(row),
    hidden: row.hidden === 1,
    updatedAt: row.updated_at,
  };
}

/** The first problem with a set as sent, in words; or the set, tidied. */
function parseSet(body: unknown): Result<{ set: z.infer<typeof SetSchema> }> {
  const parsed = SetSchema.safeParse(body, { error: () => 'Невалиден набор.' });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where =
      issue?.path[0] === 'questions' && typeof issue.path[1] === 'number' ? `Въпрос ${issue.path[1] + 1}: ` : '';
    return { ok: false, error: `${where}${issue?.message ?? 'Невалиден набор.'}` };
  }
  return { ok: true, set: parsed.data };
}

export function mySets(userId: number): QuestionSetSummary[] {
  return all<SetRow>('SELECT * FROM question_sets WHERE owner_id = ? ORDER BY updated_at DESC', userId).map((r) => ({
    id: r.id,
    name: r.name,
    questions: questionsOf(r).length,
    hidden: r.hidden === 1,
    updatedAt: r.updated_at,
  }));
}

export function getSet(id: number, userId: number): QuestionSetInfo | null {
  const row = owned(id, userId);
  return row ? info(row) : null;
}

export function createSet(userId: number, body: unknown, copiedFrom: number | null = null): Result<{ id: number }> {
  const parsed = parseSet(body);
  if (!parsed.ok) return parsed;
  const pictured = withPictures(parsed.set.questions);
  if (!pictured.ok) return pictured;
  const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM question_sets WHERE owner_id = ?', userId)!.n;
  if (count >= SETS.perOwner) return { ok: false, error: `Можеш да имаш най-много ${SETS.perOwner} набора.` };
  const now = Date.now();
  const id = Number(
    run(
      `INSERT INTO question_sets (owner_id, name, code, questions, copied_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId,
      parsed.set.name,
      newCode(),
      JSON.stringify(pictured.questions),
      copiedFrom,
      now,
      now,
    ).lastInsertRowid,
  );
  return { ok: true, id };
}

export function saveSet(id: number, userId: number, body: unknown): Result<{ set: QuestionSetInfo }> {
  if (!owned(id, userId)) return { ok: false, error: 'Няма такъв набор.' };
  const parsed = parseSet(body);
  if (!parsed.ok) return parsed;
  const pictured = withPictures(parsed.set.questions);
  if (!pictured.ok) return pictured;
  run(
    'UPDATE question_sets SET name = ?, questions = ?, updated_at = ? WHERE id = ?',
    parsed.set.name,
    JSON.stringify(pictured.questions),
    Date.now(),
    id,
  );
  return { ok: true, set: info(getRow(id)!) };
}

export function deleteSet(id: number, userId: number): boolean {
  return Number(run('DELETE FROM question_sets WHERE id = ? AND owner_id = ?', id, userId).changes) > 0;
}

/** A set's share link as anyone signed in sees it (a hidden one is gone, but for moderators). */
export function sharedPreview(code: string, viewerId: number, admin = false): SharedSetPreview | null {
  const row = one<SetRow & { username: string | null }>(
    'SELECT s.*, u.username FROM question_sets s LEFT JOIN users u ON u.id = s.owner_id WHERE s.code = ?',
    code,
  );
  if (!row || (row.hidden && !admin && row.owner_id !== viewerId)) return null;
  if (row.owner_id !== viewerId) count('link_opens:set');
  const questions = questionsOf(row);
  return {
    name: row.name,
    author: row.username,
    questions: questions.length,
    kinds: {
      choice: questions.filter((q) => q.kind === 'choice').length,
      truefalse: questions.filter((q) => q.kind === 'truefalse').length,
      number: questions.filter((q) => q.kind === 'number').length,
      order: questions.filter((q) => q.kind === 'order').length,
    },
    mine: row.owner_id === viewerId ? row.id : null,
    hidden: row.hidden === 1,
  };
}

/** Takes a copy of a shared set into the viewer's own (theirs to edit from then on). */
export function copySet(code: string, userId: number): Result<{ id: number }> {
  const row = one<SetRow>('SELECT * FROM question_sets WHERE code = ? AND hidden = 0', code);
  if (!row) return { ok: false, error: 'Този набор вече не е достъпен.' };
  if (row.owner_id === userId) return { ok: true, id: row.id };
  const copied = createSet(userId, { name: row.name, questions: questionsOf(row) }, row.id);
  if (copied.ok) count('link_uses:set');
  return copied;
}

/**
 * A moderator hides a set a report held up about (or shows it again): it can't be played or copied meanwhile, and its
 * pictures aren't served (copies of it show those questions without them).
 */
export function hideSet(code: string, hidden: boolean, adminId: number | null = null): boolean {
  const row = one<SetRow>('SELECT * FROM question_sets WHERE code = ?', code);
  if (!row) return false;
  tx(() => {
    run('UPDATE question_sets SET hidden = ? WHERE id = ?', hidden ? 1 : 0, row.id);
    for (const id of imageIds(questionsOf(row)))
      run('UPDATE set_images SET blocked = ? WHERE id = ?', hidden ? 1 : 0, id);
    // A moderator's (an undo from the log is logged as one already).
    if (adminId !== null)
      logAction({ adminId, action: hidden ? 'hide_set' : 'unhide_set', userId: row.owner_id, target: code, undo: {} });
  });
  return true;
}

/** A set its owner can play in a room: theirs, not hidden, with questions in it. */
export function setForRoom(id: number, userId: number): RoomSettings['set'] | 'empty' | null {
  const row = owned(id, userId);
  if (!row || row.hidden) return null;
  const count = questionsOf(row).length;
  return count ? { id: row.id, name: row.name, questions: count } : 'empty';
}

/** How a set's number question is entered and scored: the range around the answer, in steps of its precision. */
function numberSpec(n: { answer: number; unit: string; tolerance: number }) {
  const decimals = Math.min(2, (String(n.answer).split('.')[1] ?? '').length);
  const step = 10 ** -decimals;
  const span = Math.max(n.tolerance * 5, step * 10);
  const low = n.answer - span;
  return {
    answer: n.answer,
    unit: n.unit,
    min: n.answer >= 0 ? Math.max(0, low) : low,
    max: n.answer + span,
    step,
    scale: 'linear' as const,
    tolerance: n.tolerance,
  };
}

/**
 * A set's questions as a room plays them, in its owner's order (options shuffled; true or false in that order).
 * The latest version: what the host saved last. Null when it can't be played.
 */
export function prepareSet(id: number, userId: number): PreparedQuestion[] | null {
  const row = owned(id, userId);
  if (!row || row.hidden) return null;
  const questions = questionsOf(row);
  // A picture blocked or gone since (its uploader left): the question plays without it.
  const pictures = picturesOf(imageIds(questions));
  const picture = (image: SetImage | undefined): { image?: HostImage } => {
    const size = image && pictures.get(image.id);
    return image && size
      ? { image: { url: setPictureUrl(image.id), ...size, alt: image.alt || 'Снимка към въпроса' } }
      : {};
  };
  const common = (i: number) => ({
    id: `set-${row.id}-${i}`,
    category: 'general' as const,
    difficulty: 'medium' as const,
  });
  return questions.map((q, i): PreparedQuestion => {
    if (q.kind === 'number') return { ...common(i), kind: 'number', q: q.q, number: numberSpec(q.number) };
    if (q.kind === 'order') {
      // Without numbers, its places are its values.
      const numbered = q.items.every((item) => item.value !== null);
      const up = !numbered || (q.items[1].value as number) > (q.items[0].value as number);
      return {
        ...common(i),
        kind: 'order',
        q: q.q,
        items: shuffle(q.items.map((item, place) => ({ text: item.text, value: numbered ? item.value! : place }))),
        direction: up ? 'asc' : 'desc',
        unit: q.unit,
        hideValues: !numbered,
      };
    }
    if (q.kind === 'truefalse')
      return { ...common(i), q: q.q, options: ['Вярно', 'Невярно'], answer: q.answer ? 0 : 1, ...picture(q.image) };
    const order = shuffle([0, 1, 2, 3]);
    return {
      ...common(i),
      q: q.q,
      options: order.map((o) => q.options[o]),
      answer: order.indexOf(q.answer),
      ...picture(q.image),
    };
  });
}
