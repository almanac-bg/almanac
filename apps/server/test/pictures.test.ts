// Set pictures by index (v44, sets.ts → sweepPictures; the 31 October review, SERVER-10): the database keeps which set
// uses which picture, and since when one no set uses has been unused, whatever writes the sets — so the daily sweep
// deletes by index instead of reading every set's questions, and a picture goes a day after its last use, not before.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-pictures-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DAY = 24 * 60 * 60_000;
const questions = (...ids: (string | null)[]) =>
  JSON.stringify(
    ids.map((id, i) => ({
      kind: 'truefalse',
      q: `Въпрос ${i + 1}`,
      answer: true,
      ...(id && { image: { id, alt: '', w: 800, h: 600 } }),
    })),
  );

test('the sets from before (v43) come in with their pictures: those in a set are used, the rest unused since upload', () => {
  const file = path.join(tmp, 'v43.db');
  // MIGRATE_TO: only this far, a database as v43 left it (none of v44), then the rest at the next start.
  const boot = (to?: number) =>
    spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/db.ts')"], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, DB_PATH: file, BACKUP_DIR: 'off', ...(to !== undefined && { MIGRATE_TO: String(to) }) },
      encoding: 'utf8',
    });
  assert.equal(boot(43).status, 0, 'a database as v43 left it');
  const db = new DatabaseSync(file);
  try {
    // Two sets written before v44.
    db.exec(`
      INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (1, 'host', 'host', 'x', 0);
    `);
    for (const [id, at] of [
      ['in-a-set', 100],
      ['in-two', 200],
      ['spare', 300],
    ] as const)
      db.prepare(
        "INSERT INTO set_images (owner_id, id, type, bytes, w, h, created_at) VALUES (1, ?, 'image/webp', x'00', 800, 600, ?)",
      ).run(id, at);
    const set = db.prepare(
      'INSERT INTO question_sets (owner_id, name, code, questions, created_at, updated_at) VALUES (1, ?, ?, ?, 0, 0)',
    );
    set.run('Урок 1', 'AAAAAA', questions('in-a-set', 'in-two', null));
    set.run('Урок 2', 'BBBBBB', questions('in-two'));

    const migrated = boot();
    assert.equal(migrated.status, 0, migrated.stderr);
    assert.deepEqual(
      db
        .prepare('SELECT image_id, set_id FROM set_image_uses ORDER BY image_id, set_id')
        .all()
        .map((r) => ({ ...r })),
      [
        { image_id: 'in-a-set', set_id: 1 },
        { image_id: 'in-two', set_id: 1 },
        { image_id: 'in-two', set_id: 2 },
      ],
    );
    assert.deepEqual(
      db
        .prepare('SELECT owner_id, id, since FROM unused_pictures')
        .all()
        .map((r) => ({ ...r })),
      [{ owner_id: 1, id: 'spare', since: 300 }],
      'unused since it was uploaded; the two in sets, used',
    );
  } finally {
    db.close();
  }
});

test('a picture goes a day after no set uses it — not while a copy has it, nor when it comes back the same day', async () => {
  process.env.DB_PATH = path.join(tmp, 'live.db');
  const { one, run } = await import('../src/db');
  const { sweepPictures } = await import('../src/sets');
  for (const id of [1, 2])
    run(
      "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, 'x', 0)",
      id,
      `u${id}`,
      `u${id}`,
    );
  const upload = (owner: number, id: string, at = Date.now()) =>
    run(
      "INSERT INTO set_images (owner_id, id, type, bytes, w, h, created_at) VALUES (?, ?, 'image/webp', x'00', 800, 600, ?)",
      owner,
      id,
      at,
    );
  const set = (owner: number, code: string, ...ids: (string | null)[]) =>
    Number(
      run(
        'INSERT INTO question_sets (owner_id, name, code, questions, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)',
        owner,
        code,
        code,
        questions(...ids),
      ).lastInsertRowid,
    );
  const edit = (id: number, ...ids: (string | null)[]) =>
    run('UPDATE question_sets SET questions = ? WHERE id = ?', questions(...ids), id);
  const unusedSince = (id: string, owner = 1) =>
    one<{ at: number }>('SELECT since AS at FROM unused_pictures WHERE owner_id = ? AND id = ?', owner, id)?.at ?? null;
  const kept = (id: string) => !!one('SELECT 1 AS x FROM set_images WHERE id = ?', id);
  const later = Date.now() + DAY + 60_000;

  // Uploaded and left (an editor closed before saving): unused from its upload; in a set: used.
  const uploaded = Date.now() - 2 * DAY;
  upload(1, 'castle', uploaded);
  upload(1, 'left', uploaded);
  assert.equal(unusedSince('castle'), uploaded);
  const lesson = set(1, 'LESSON', 'castle', null);
  assert.equal(unusedSince('castle'), null);
  assert.equal(unusedSince('left'), uploaded);

  // Another host's copy has it too: taken out of the first set, it is still used.
  const copy = set(2, 'COPY', 'castle');
  edit(lesson, null, null);
  assert.equal(unusedSince('castle'), null, 'the copy still has it');
  // The copy deleted: unused from now — and a day's grace from now, not from the upload two days ago.
  run('DELETE FROM question_sets WHERE id = ?', copy);
  const since = unusedSince('castle')!;
  assert.ok(Math.abs(since - Date.now()) < 5_000, `unused since now, got ${Date.now() - since} ms ago`);
  assert.equal(sweepPictures(), 1, 'the one left two days ago goes; the castle has its day');
  assert.ok(kept('castle') && !kept('left'));

  // Back in the set the same day: used again, and it stays.
  edit(lesson, 'castle');
  assert.equal(unusedSince('castle'), null);
  assert.equal(sweepPictures(later), 0);

  // The same picture uploaded by another host as well: one row each, both used while any set has it.
  upload(2, 'castle');
  assert.equal(unusedSince('castle', 2), null, 'already in a set');
  // The host's account erased (its sets go by cascade): the other's row of it is unused from then, and goes a day on.
  run('DELETE FROM users WHERE id = 1');
  assert.ok(unusedSince('castle', 2));
  assert.equal(sweepPictures(), 0);
  assert.equal(sweepPictures(later), 1);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) AS n FROM set_images')!.n, 0);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) AS n FROM set_image_uses')!.n, 0);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) AS n FROM unused_pictures')!.n, 0, 'gone with the pictures');
});
