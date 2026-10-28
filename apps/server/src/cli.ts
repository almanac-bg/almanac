// Server administration from the command line (run next to the live server; SQLite handles both).
//   node apps/server/dist/cli.mjs admin add <username>     — make a player a moderator
//   node apps/server/dist/cli.mjs admin remove <username>  — take it away
//   node apps/server/dist/cli.mjs admin list
//   node apps/server/dist/cli.mjs guests off | on | status — turn new guests away (a flood of them), or let them in again
// In Docker: docker compose exec app node apps/server/dist/cli.mjs admin add <username>
import { all, run } from './db';
import { guestsPaused, pauseGuests } from './settings';
import { getUserByName } from './users';

const [area, command, username] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const USAGE =
  'Usage: cli admin add <username> | admin remove <username> | admin list | guests off | guests on | guests status';

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
