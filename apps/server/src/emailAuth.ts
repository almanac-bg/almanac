import { createHash, randomBytes } from 'node:crypto';
import { PASSWORD_MIN_LENGTH } from '@quiz/shared';
import { z } from 'zod';
import { hashPassword, hashToken as hashSessionToken, verifyPassword } from './auth';
import { isCommonPassword } from './commonPasswords';
import { config } from './config';
import { one, run, tx } from './db';
import { emailChangedMail, type Mail, resetPasswordMail, sendMail, verifyEmailMail } from './mailer';
import { disconnectOtherSessions, disconnectUser } from './notify';
import { throttled } from './throttle';
import { emailKey, getUser, getUserByEmail, getUserByLogin } from './users';

type Purpose = 'verify' | 'reset';
const TTL: Record<Purpose, number> = { verify: 24 * 60 * 60_000, reset: 60 * 60_000 };

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export const EmailSchema = z.email('Невалиден имейл.').max(254);
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Паролата трябва да е поне ${PASSWORD_MIN_LENGTH} символа.`)
  .max(200)
  .refine((p) => !isCommonPassword(p), 'Тази парола е сред най-често използваните — избери по-необичайна.');

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
  const row = one<{
    user_id: number;
    email: string | null;
    expires_at: number;
    used_at: number | null;
    purpose: string;
  }>('SELECT user_id, email, expires_at, used_at, purpose FROM email_tokens WHERE token_hash = ?', hashToken(token));
  if (!row || row.purpose !== purpose || row.used_at !== null || row.expires_at < Date.now()) return null;
  run('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?', Date.now(), hashToken(token));
  return { userId: row.user_id, email: row.email };
}

/** Unused reset links die whenever the password or the address changes: a link mailed before can't undo the change. */
function dropResetLinks(userId: number) {
  run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'reset'", userId);
}

const link = (path: string, token: string) => `${config.appUrl}${path}?token=${encodeURIComponent(token)}`;

/**
 * Sets an address as pending and mails a verification link. It doesn't say whether the address is already
 * taken (that would reveal who plays here) — verification refuses it instead, and only the mailbox owner sees that.
 */
export function requestEmailChange(userId: number, email: string, net: string): Result {
  const parsed = EmailSchema.safeParse(email.trim());
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const user = getUser(userId)!;
  if (user.email_key === emailKey(parsed.data)) return { ok: false, error: 'Това вече е твоят имейл.' };
  // Whoever types an address, it's the mailbox's owner who gets the mail: a few a day per address (sign-up, a saved
  // guest and Settings all come through here), and a ceiling for all of them, so nobody can mail a stranger in the
  // site's name again and again.
  if (
    throttled(`email-to:${emailKey(parsed.data)}`, 3, 24 * 60 * 60_000) ||
    // One network's share of the ceiling below: no single sender can use all of it up for everyone else.
    throttled(`verify-mail-net:${net}`, 20, 60 * 60_000) ||
    throttled('verify-mail-all', 300, 60 * 60_000)
  )
    return { ok: false, error: 'Твърде много писма до този адрес. Опитай отново утре.' };
  run('UPDATE users SET pending_email = ? WHERE id = ?', parsed.data, userId);
  const token = issueToken(userId, 'verify', parsed.data);
  sendMail(verifyEmailMail(parsed.data, user.username, link('/verify-email', token)));
  return { ok: true };
}

export function removeEmail(userId: number) {
  const user = getUser(userId)!;
  run(
    'UPDATE users SET email = NULL, email_key = NULL, pending_email = NULL, email_bounced_at = NULL WHERE id = ?',
    userId,
  );
  run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'verify'", userId);
  dropResetLinks(userId);
  if (user.email) sendMail(emailChangedMail(user.email, user.username, true));
}

export function verifyEmailToken(token: string): Result<{ userId: number }> {
  const { result, notice } = tx((): { result: Result<{ userId: number }>; notice?: Mail } => {
    const t = consumeToken(token, 'verify');
    if (!t?.email) return { result: { ok: false, error: 'Линкът е невалиден или е изтекъл.' } };
    const owner = getUserByEmail(t.email);
    if (owner && owner.id !== t.userId)
      return { result: { ok: false, error: 'Този имейл вече е свързан с друг профил.' } };
    const before = getUser(t.userId)!;
    if (before.email_key !== emailKey(t.email)) dropResetLinks(t.userId);
    run(
      'UPDATE users SET email = ?, email_key = ?, pending_email = NULL, email_bounced_at = NULL WHERE id = ?',
      t.email,
      emailKey(t.email),
      t.userId,
    );
    // The old address hears about the switch (someone with a moment at an unlocked device can't quietly take over).
    const switched = before.email && before.email_key !== emailKey(t.email);
    return {
      result: { ok: true, userId: t.userId },
      notice: switched ? emailChangedMail(before.email!, before.username, false) : undefined,
    };
  });
  // Sent once the change is saved: a mail can't be taken back.
  if (notice) sendMail(notice);
  return result;
}

/** Mails a reset link if the account has a verified email. Says nothing either way. */
export function requestPasswordReset(login: string) {
  const user = getUserByLogin(login.trim());
  if (!user?.email) return;
  // Per account, whichever name or address it was asked by: a stranger can't fill someone's inbox with resets.
  if (
    throttled(`reset-mail:#${user.id}`, 5, 60 * 60_000) ||
    throttled(`reset-mail-day:#${user.id}`, 10, 24 * 60 * 60_000)
  )
    return;
  const token = issueToken(user.id, 'reset', user.email);
  sendMail(resetPasswordMail(user.email, user.username, link('/reset-password', token)));
}

/** Sets the new password and logs the account out everywhere. */
export async function resetPassword(token: string, password: string): Promise<Result<{ userId: number }>> {
  const hash = await hashPassword(password);
  const result = tx((): Result<{ userId: number }> => {
    const t = consumeToken(token, 'reset');
    // Mailed to an address the account no longer has: whoever reads that mailbox now has no say over the account.
    if (!t?.email || getUser(t.userId)?.email_key !== emailKey(t.email))
      return { ok: false, error: 'Линкът е невалиден или е изтекъл. Поискай нов.' };
    run('UPDATE users SET password_hash = ? WHERE id = ?', hash, t.userId);
    run('DELETE FROM sessions WHERE user_id = ?', t.userId);
    run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'reset'", t.userId);
    return { ok: true, userId: t.userId };
  });
  if (result.ok) disconnectUser(result.userId);
  return result;
}

/** Changes the password; every other session is logged out, the current one stays. */
export async function changePassword(
  userId: number,
  current: string,
  next: string,
  keepToken: string | null,
): Promise<Result> {
  const user = getUser(userId)!;
  if (!(await verifyPassword(current, user.password_hash))) return { ok: false, error: 'Текущата парола е грешна.' };
  const hash = await hashPassword(next);
  run('UPDATE users SET password_hash = ? WHERE id = ?', hash, userId);
  dropResetLinks(userId);
  const keep = keepToken ? hashSessionToken(keepToken) : '';
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', userId, keep);
  disconnectOtherSessions(userId, keep || null);
  return { ok: true };
}
