// Server administration from the command line (run next to the live server; SQLite handles both).
//   node apps/server/dist/cli.mjs admin add <username>     — make a player a moderator
//   node apps/server/dist/cli.mjs admin owner <username>   — make them the owner (decides about moderators, keeps the
//                                                            bank and the numbers)
//   node apps/server/dist/cli.mjs admin remove <username>  — take either away
//   node apps/server/dist/cli.mjs admin 2fa-reset <username> — a lost phone: their authenticator app set up anew
//   node apps/server/dist/cli.mjs admin list
//   node apps/server/dist/cli.mjs guests off | on | status — turn new guests away (a flood of them), or let them in again
//   node apps/server/dist/cli.mjs vapid-keys               — a key pair for web push, as .env lines (append them:
//                                                            … vapid-keys >> .env, so the private key is never shown)
//   node apps/server/dist/cli.mjs notice "<text>" [/link]  — a note to every player (e.g. 14 days before the terms
//                                                            or the privacy policy change, as both promise)
//   node apps/server/dist/cli.mjs check-bank               — whether this code loads the question bank (QUESTIONS_PATH):
//                                                            deploy/deploy.sh asks before it switches to either
//   node apps/server/dist/cli.mjs live                     — what's going on in the server running next to it: people
//                                                            online, matches, rooms, the evening, and what a restart
//                                                            now would cut short (deploy/deploy.sh waits for that)
//   node apps/server/dist/cli.mjs names                    — names already taken that today's name check would refuse
//                                                            (players, groups, sets), to rename through /admin
// In Docker: docker compose exec app node apps/server/dist/cli.mjs admin add <username>
import webpush from 'web-push';
import { config } from './config';
import { all, run } from './db';
import { nameProblem } from './moderation';
import { logAction } from './modlog';
import { textProblem } from './names';
import { imageBank, numberBank, orderBank, questionBank } from './questions';
import { guestsPaused, pauseGuests } from './settings';
import { getUserByName } from './users';

const [area, command, username] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const USAGE =
  'Usage: cli admin add <username> | admin owner <username> | admin remove <username> | admin 2fa-reset <username> | admin list | guests off | guests on | guests status | notice "<text>" [/link] | vapid-keys | check-bank | live | names';

if (area === 'check-bank') {
  try {
    const count = questionBank().length + imageBank().length + numberBank().length + orderBank().length;
    console.log(`✅ The question bank loads: ${count} questions in play.`);
    process.exit(0);
  } catch (err) {
    fail(`❌ The question bank doesn't load: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (area === 'live') {
  const res = await fetch(`http://127.0.0.1:${config.port}/api/live`).catch(() => null);
  if (!res?.ok) fail(`The server isn't answering on port ${config.port} here.`);
  console.log(JSON.stringify(await res.json(), null, 2));
  process.exit(0);
}

if (area === 'names') {
  // Read-only: what the check says of each name now. Guests' generated names and hidden sets are left out.
  const rows = [
    ...all<{ id: number; name: string }>('SELECT id, username AS name FROM users WHERE is_guest = 0').map((r) => ({
      ...r,
      kind: 'player',
      problem: nameProblem(r.name),
    })),
    ...all<{ id: number; name: string }>('SELECT id, name FROM player_groups').map((r) => ({
      ...r,
      kind: 'group',
      problem: textProblem(r.name, 'Името'),
    })),
    ...all<{ id: number; name: string }>('SELECT id, name FROM question_sets WHERE hidden = 0').map((r) => ({
      ...r,
      kind: 'set',
      problem: textProblem(r.name, 'Името'),
    })),
  ].filter((r) => r.problem);
  console.log(
    rows.length
      ? rows.map((r) => `${r.kind} #${r.id}\t${r.name}\t${r.problem}`).join('\n')
      : '✅ Every name in use passes the check.',
  );
  process.exit(0);
}

if (area === 'vapid-keys') {
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
  process.exit(0);
}

if (area === 'notice') {
  const [text, link] = process.argv.slice(3).map((a) => a.trim());
  if (!text || text.length > 300) fail('Usage: cli notice "<text, up to 300 characters>" [/link]');
  if (link && !/^\/[\w/-]*$/.test(link)) fail('The link is a path on this site, like /privacy');
  const { changes } = run(
    "INSERT INTO notifications (user_id, icon, text, link, created_at) SELECT id, '📣', ?, ?, ? FROM users",
    text,
    link || null,
    Date.now(),
  );
  console.log(`📣 Left for ${changes} players (they see it the next time they open the game).`);
  process.exit(0);
}

if (area === 'guests') {
  if (!['off', 'on', 'status'].includes(command ?? '')) fail(USAGE);
  if (command !== 'status') pauseGuests(command === 'off');
  console.log(guestsPaused() ? '⛔ New guests are turned away (sign-ups still work).' : '✅ New guests are let in.');
  process.exit(0);
}

if (area !== 'admin' || !['add', 'owner', 'remove', '2fa-reset', 'list'].includes(command ?? '')) fail(USAGE);

if (command === 'list') {
  const staff = all<{ username: string; staff_role: string | null; totp_on_at: number | null }>(
    'SELECT username, staff_role, totp_on_at FROM users WHERE is_admin = 1 ORDER BY username',
  );
  console.log(
    staff.length
      ? staff
          .map((s) => `${s.username}\t${s.staff_role ?? 'moderator'}\t${s.totp_on_at ? '2FA on' : '2FA not set up'}`)
          .join('\n')
      : '(no admins)',
  );
} else {
  if (!username) fail(`Usage: cli admin ${command} <username>`);
  const user = getUserByName(username);
  if (!user) fail(`No player named "${username}". Register the account first, then run this again.`);
  // In the moderation log, as the command line's (no moderator account did it).
  if (command === 'add' || command === 'owner') {
    const role = command === 'owner' ? 'owner' : 'moderator';
    run('UPDATE users SET is_admin = 1, staff_role = ? WHERE id = ?', role, user.id);
    logAction({
      adminId: null,
      action: 'staff_add',
      userId: user.id,
      reason: role === 'owner' ? 'Собственик' : 'Модератор',
    });
    console.log(
      `✅ ${user.username} is now ${role === 'owner' ? 'the owner' : 'a moderator'}. They set up two-factor sign-in on /admin.`,
    );
  } else if (command === 'remove') {
    run(
      'UPDATE users SET is_admin = 0, staff_role = NULL, totp_secret = NULL, totp_on_at = NULL, totp_step = NULL WHERE id = ?',
      user.id,
    );
    run('UPDATE sessions SET second_factor_at = NULL WHERE user_id = ?', user.id);
    logAction({ adminId: null, action: 'staff_remove', userId: user.id });
    console.log(`✅ ${user.username} is no longer staff.`);
  } else {
    run('UPDATE users SET totp_secret = NULL, totp_on_at = NULL, totp_step = NULL WHERE id = ?', user.id);
    run('UPDATE sessions SET second_factor_at = NULL WHERE user_id = ?', user.id);
    logAction({ adminId: null, action: 'staff_2fa_reset', userId: user.id });
    console.log(`✅ ${user.username} sets up two-factor sign-in anew on their next visit to /admin.`);
  }
}
