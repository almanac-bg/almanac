// Server administration from the command line (run next to the live server; SQLite handles both).
//   node apps/server/dist/cli.mjs admin add <username>     — make a player a moderator
//   node apps/server/dist/cli.mjs admin remove <username>  — take it away
//   node apps/server/dist/cli.mjs admin list
//   node apps/server/dist/cli.mjs guests off | on | status — turn new guests away (a flood of them), or let them in again
//   node apps/server/dist/cli.mjs vapid-keys               — a key pair for web push, as .env lines (append them:
//                                                            … vapid-keys >> .env, so the private key is never shown)
//   node apps/server/dist/cli.mjs notice "<text>" [/link]  — a note to every player (e.g. 14 days before the terms
//                                                            or the privacy policy change, as both promise)
// In Docker: docker compose exec app node apps/server/dist/cli.mjs admin add <username>
import webpush from 'web-push';
import { all, run } from './db';
import { guestsPaused, pauseGuests } from './settings';
import { getUserByName } from './users';

const [area, command, username] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const USAGE =
  'Usage: cli admin add <username> | admin remove <username> | admin list | guests off | guests on | guests status | notice "<text>" [/link] | vapid-keys';

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

if (area !== 'admin' || !['add', 'remove', 'list'].includes(command ?? '')) fail(USAGE);

if (command === 'list') {
  const admins = all<{ username: string }>('SELECT username FROM users WHERE is_admin = 1 ORDER BY username');
  console.log(admins.length ? admins.map((a) => a.username).join('\n') : '(no admins)');
} else {
  if (!username) fail(`Usage: cli admin ${command} <username>`);
  const user = getUserByName(username);
  if (!user) fail(`No player named "${username}". Register the account first, then run this again.`);
  run('UPDATE users SET is_admin = ? WHERE id = ?', command === 'add' ? 1 : 0, user.id);
  console.log(
    command === 'add' ? `✅ ${user.username} is now an admin.` : `✅ ${user.username} is no longer an admin.`,
  );
}
