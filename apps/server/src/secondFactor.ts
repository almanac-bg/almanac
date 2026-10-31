import { run } from './db';
import { sendMail, staffSignInMail } from './mailer';
import { logAction } from './modlog';
import type { UserRow } from './users';

/**
 * The staff second factor's limits, kept in the database so a restart doesn't start them again (the 31 October review,
 * SEC-2): ten wrong codes in a row are free (a clock that's off, a typo); after that each next try waits twice as long
 * as the one before — 15 minutes, 30, an hour … up to a day — and at 100 (NIST SP 800-63B's ceiling) it stops until
 * the owner resets it on the server (`cli admin 2fa-reset`). A right code clears it. Guessing one of the three codes
 * accepted at a time then takes years, not months.
 */
export const SECOND_FACTOR = { freeTries: 10, firstWaitMs: 15 * 60_000, longestWaitMs: 24 * 3_600_000, stopAt: 100 };

export type SecondFactorHold = { stopped: true } | { stopped: false; until: number } | null;

/** Whether the account may try a code now: null if it may; otherwise until when it waits, or that it's stopped. */
export function secondFactorHold(
  user: Pick<UserRow, 'totp_failures' | 'totp_failed_at'>,
  now = Date.now(),
): SecondFactorHold {
  const failures = user.totp_failures ?? 0;
  if (failures >= SECOND_FACTOR.stopAt) return { stopped: true };
  if (failures < SECOND_FACTOR.freeTries || !user.totp_failed_at) return null;
  const wait = Math.min(
    SECOND_FACTOR.longestWaitMs,
    SECOND_FACTOR.firstWaitMs * 2 ** (failures - SECOND_FACTOR.freeTries),
  );
  const until = user.totp_failed_at + wait;
  return until > now ? { stopped: false, until } : null;
}

/**
 * A wrong code after the right password. The first of a run is the moment someone else may have the password: the
 * staff member hears of it, and the log keeps it; so does the stop at 100.
 */
export function secondFactorFailed(user: UserRow, now = Date.now()) {
  const failures = (user.totp_failures ?? 0) + 1;
  run('UPDATE users SET totp_failures = ?, totp_failed_at = ? WHERE id = ?', failures, now, user.id);
  const first = failures === 1;
  const stopped = failures === SECOND_FACTOR.stopAt;
  if (!first && !stopped) return;
  logAction({ adminId: null, action: stopped ? 'second_factor_locked' : 'second_factor_failed', userId: user.id });
  if (user.email) sendMail(staffSignInMail(user.email, user.username, stopped ? 'locked' : 'wrong-code', now));
}

/** A right code: the run of wrong ones is over, and the sign-in is told to its owner and kept in the log. */
export function secondFactorPassed(user: UserRow, now = Date.now()) {
  run('UPDATE users SET totp_failures = 0, totp_failed_at = NULL WHERE id = ?', user.id);
  logAction({ adminId: user.id, action: 'staff_sign_in' });
  if (user.email) sendMail(staffSignInMail(user.email, user.username, 'sign-in', now));
}
