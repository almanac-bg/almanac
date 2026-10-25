// Server administration from the command line (run next to the live server; SQLite handles both).
//   node apps/server/dist/cli.mjs admin add <username>     — make a player a moderator
//   node apps/server/dist/cli.mjs admin remove <username>  — take it away
//   node apps/server/dist/cli.mjs admin list
// In Docker: docker compose exec app node apps/server/dist/cli.mjs admin add <username>
import { all, run } from './db';
import { getUserByName } from './users';

const [area, command, username] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (area !== 'admin' || !['add', 'remove', 'list'].includes(command ?? '')) {
  fail('Usage: cli admin add <username> | admin remove <username> | admin list');
}

if (command === 'list') {
  const admins = all<{ username: string }>('SELECT username FROM users WHERE is_admin = 1 ORDER BY username');
  console.log(admins.length ? admins.map((a) => a.username).join('\n') : '(no admins)');
} else {
  if (!username) fail(`Usage: cli admin ${command} <username>`);
  const user = getUserByName(username);
  if (!user) fail(`No player named "${username}". Register the account first, then run this again.`);
  run('UPDATE users SET is_admin = ? WHERE id = ?', command === 'add' ? 1 : 0, user.id);
  console.log(command === 'add' ? `✅ ${user.username} is now an admin.` : `✅ ${user.username} is no longer an admin.`);
}
