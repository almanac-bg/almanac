import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './auth';
import { config } from './config';
import { one, run, tx } from './db';
import { resetPasswordMail, sendMail, verifyEmailMail } from './mailer';
import { disconnectUser } from './notify';
import { emailKey, getUser, getUserByEmail, getUserByLogin } from './users';

type Purpose = 'verify' | 'reset';
const TTL: Record<Purpose, number> = { verify: 24 * 60 * 60_000, reset: 60 * 60_000 };

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export const EmailSchema = z.email('Невалиден имейл.').max(254);
export const PasswordSchema = z.string().min(6, 'Паролата трябва да е поне 6 символа.').max(200);

// Only a hash is stored, so a leaked database can't be used to reset passwords.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function issueToken(userId: number, purpose: Purpose, email: string | null): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  // A new link replaces older unused ones of the same kind.
  run('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL', userId, purpose);
  run(
    'INSERT INTO email_tokens (token_hash, user_id, purpose, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    hashToken(token),
    userId,
    purpose,
    email,
    now,
    now + TTL[purpose],
  );
  return token;
}

/** Marks a token used and returns what it was issued for; null if unknown, used, expired or the wrong kind. */
function consumeToken(token: string, purpose: Purpose): { userId: number; email: string | null } | null {
  const row = one<{ user_id: number; email: string | null; expires_at: number; used_at: number | null; purpose: string }>(
    'SELECT user_id, email, expires_at, used_at, purpose FROM email_tokens WHERE token_hash = ?',
    hashToken(token),
  );
  if (!row || row.purpose !== purpose || row.used_at !== null || row.expires_at < Date.now()) return null;
  run('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?', Date.now(), hashToken(token));
  return { userId: row.user_id, email: row.email };
}

const link = (path: string, token: string) => `${config.appUrl}${path}?token=${encodeURIComponent(token)}`;

/**
 * Sets an address as pending and mails a verification link. It doesn't say whether the address is already
 * taken (that would reveal who plays here) — verification refuses it instead, and only the mailbox owner sees that.
 */
export function requestEmailChange(userId: number, email: string): Result {
  const parsed = EmailSchema.safeParse(email.trim());
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const user = getUser(userId)!;
  if (user.email_key === emailKey(parsed.data)) return { ok: false, error: 'Това вече е твоят имейл.' };
  run('UPDATE users SET pending_email = ? WHERE id = ?', parsed.data, userId);
  const token = issueToken(userId, 'verify', parsed.data);
  sendMail(verifyEmailMail(parsed.data, user.username, link('/verify-email', token)));
  return { ok: true };
}

export function removeEmail(userId: number) {
  run('UPDATE users SET email = NULL, email_key = NULL, pending_email = NULL WHERE id = ?', userId);
  run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'verify'", userId);
}

export function verifyEmailToken(token: string): Result<{ userId: number }> {
  return tx(() => {
    const t = consumeToken(token, 'verify');
    if (!t?.email) return { ok: false, error: 'Линкът е невалиден или е изтекъл.' };
    const owner = getUserByEmail(t.email);
    if (owner && owner.id !== t.userId) return { ok: false, error: 'Този имейл вече е свързан с друг профил.' };
    run(
      'UPDATE users SET email = ?, email_key = ?, pending_email = NULL WHERE id = ?',
      t.email,
      emailKey(t.email),
      t.userId,
    );
    return { ok: true, userId: t.userId };
  });
}

/** Mails a reset link if the account has a verified email. Says nothing either way. */
export function requestPasswordReset(login: string) {
  const user = getUserByLogin(login.trim());
  if (!user?.email) return;
  const token = issueToken(user.id, 'reset', user.email);
  sendMail(resetPasswordMail(user.email, user.username, link('/reset-password', token)));
}

/** Sets the new password and logs the account out everywhere. */
export async function resetPassword(token: string, password: string): Promise<Result<{ userId: number }>> {
  const hash = await hashPassword(password);
  return tx(() => {
    const t = consumeToken(token, 'reset');
    if (!t) return { ok: false, error: 'Линкът е невалиден или е изтекъл. Поискай нов.' };
    run('UPDATE users SET password_hash = ? WHERE id = ?', hash, t.userId);
    run('DELETE FROM sessions WHERE user_id = ?', t.userId);
    run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'reset'", t.userId);
    disconnectUser(t.userId);
    return { ok: true, userId: t.userId };
  });
}

/** Changes the password; every other session is logged out, the current one stays. */
export async function changePassword(userId: number, current: string, next: string, keepToken: string | null): Promise<Result> {
  const user = getUser(userId)!;
  if (!(await verifyPassword(current, user.password_hash))) return { ok: false, error: 'Текущата парола е грешна.' };
  const hash = await hashPassword(next);
  run('UPDATE users SET password_hash = ? WHERE id = ?', hash, userId);
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', userId, keepToken ?? '');
  return { ok: true };
}
