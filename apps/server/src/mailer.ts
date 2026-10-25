import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND, TIME_ZONE } from '@quiz/shared';
import nodemailer from 'nodemailer';
import { config } from './config';
import { reportError } from './monitoring';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;
if (!transport && config.production) {
  console.warn('✉️  SMTP_URL is not set: password-reset and verification emails are not being sent.');
}

/**
 * Sends in the background; failures are logged and reported (an expired SMTP key would otherwise stop every email
 * quietly), never surfaced to the requester. Logs and reports never contain addresses or links (they hold live
 * tokens) — except in development without SMTP, where the console stands in for the inbox.
 */
export function sendMail(mail: Mail) {
  if (config.mailOutbox) {
    fs.mkdirSync(config.mailOutbox, { recursive: true });
    const name = `${Date.now()}-${randomBytes(3).toString('hex')}.json`;
    fs.writeFileSync(path.join(config.mailOutbox, name), JSON.stringify(mail));
  }
  if (transport) {
    transport.sendMail({ from: config.mailFrom, ...mail }).catch((err) => {
      // A mail server's error can quote the recipient ("550 <x@y>: no such user"): never into a report.
      const message = String(err instanceof Error ? err.message : err).replace(/[^\s<>"@]+@[^\s<>"@]+/g, '<address>');
      void reportError(new Error(message), 'email', { extra: { subject: mail.subject } });
    });
  } else if (config.production) {
    console.warn(`✉️  Not sent (SMTP_URL not set): "${mail.subject}"`);
  } else if (!config.mailOutbox) {
    console.log(`✉️  (SMTP_URL not set) To: ${mail.to} — ${mail.subject}\n${mail.text}\n`);
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(title: string, intro: string, button: string, link: string, outro: string) {
  return `<!doctype html><html lang="bg"><body style="margin:0;background:#0b0915;font-family:Arial,Helvetica,sans-serif;color:#f5f3ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#15122a;border-radius:20px;padding:32px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:26px;font-weight:900;letter-spacing:1px;color:#c4b5fd">${BRAND.name}⚡</td></tr>
<tr><td style="padding-top:20px;font-size:20px;font-weight:bold">${escapeHtml(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#d4d0ea">${intro}</td></tr>
<tr><td style="padding:28px 0"><a href="${link}" style="display:inline-block;background:#8b5cf6;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:14px">${escapeHtml(button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#8f89b2">${outro}<br><br>Ако бутонът не работи, отвори този линк:<br><a href="${link}" style="color:#a78bfa;word-break:break-all">${link}</a></td></tr>
</table><p style="font-size:12px;color:#6b6590">${BRAND.domain}</p></td></tr></table></body></html>`;
}

export function verifyEmailMail(to: string, username: string, link: string): Mail {
  return {
    to,
    subject: `Потвърди имейла си в ${BRAND.name}`,
    text: `Здравей, ${username}!\n\nПотвърди имейла си, за да можеш да възстановиш паролата си, ако я забравиш:\n${link}\n\nЛинкът е валиден 24 часа. Ако не си ти, просто игнорирай това писмо.`,
    html: layout(
      `Здравей, ${username}!`,
      'Потвърди имейла си, за да можеш да възстановиш паролата си, ако някога я забравиш.',
      'Потвърди имейла',
      link,
      'Линкът е валиден 24 часа. Ако не си ти, просто игнорирай това писмо.',
    ),
  };
}

/** To the previous address when a profile's email is changed or removed: the owner hears about it. */
export function emailChangedMail(to: string, username: string, removed: boolean): Mail {
  const what = removed ? 'Имейлът беше премахнат от профила ти' : 'Профилът ти вече използва друг имейл';
  const advice = `Ако промяната не е от теб, смени паролата си веднага и ни пиши на ${config.operator.email}.`;
  return {
    to,
    subject: `${what} в ${BRAND.name}`,
    text: `Здравей, ${username}!\n\n${what} (${BRAND.domain}). Затова това е последното писмо, което получаваш на този адрес.\n\n${advice}`,
    html: layout(
      `Здравей, ${username}!`,
      `${what}. Затова това е последното писмо, което получаваш на този адрес.`,
      'Към настройките',
      `${config.appUrl}/settings`,
      escapeHtml(advice),
    ),
  };
}

export function resetPasswordMail(to: string, username: string, link: string): Mail {
  return {
    to,
    subject: `Нова парола за ${BRAND.name}`,
    text: `Здравей, ${username}!\n\nПолучихме заявка за нова парола за профила ти. Избери нова парола тук:\n${link}\n\nЛинкът е валиден 1 час и може да се използва веднъж. Ако заявката не е от теб, игнорирай това писмо — старата ти парола остава.`,
    html: layout(
      `Здравей, ${username}!`,
      'Получихме заявка за нова парола за профила ти.',
      'Избери нова парола',
      link,
      'Линкът е валиден 1 час и може да се използва веднъж. Ако заявката не е от теб, игнорирай това писмо — старата ти парола остава.',
    ),
  };
}

/** A month before an account nobody has used for three years is deleted (the privacy policy's limit). */
export function inactiveAccountMail(to: string, username: string, deleteOn: number): Mail {
  const date = new Intl.DateTimeFormat('bg-BG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(deleteOn);
  const lead = `Профилът ти в ${BRAND.name} не е използван от три години. За да не пазим данни, които никой не ползва, на ${date} ще го изтрием заедно с нивото, статистиката и всичко изиграно.`;
  const keep = 'Искаш да го запазиш? Просто влез в профила си дотогава — нищо друго не е нужно.';
  return {
    to,
    subject: `Профилът ти в ${BRAND.name} ще бъде изтрит след месец`,
    text: `Здравей, ${username}!\n\n${lead}\n\n${keep}\n${config.appUrl}/`,
    html: layout(`Здравей, ${username}!`, escapeHtml(lead), 'Влез в профила', `${config.appUrl}/`, escapeHtml(keep)),
  };
}

/**
 * The evening nudge when a daily streak is about to break. Opt-in, and every one carries a working unsubscribe link,
 * plus the one-click unsubscribe headers mail apps show as their own button.
 */
export function streakReminderMail(
  to: string,
  username: string,
  streak: number,
  shields: number,
  unsubscribe: { page: string; api: string },
): Mail {
  const lead = `Серията ти от ${streak} дни в дневното предизвикателство изтича в полунощ.`;
  const shield = shields > 0 ? ' Имаш и защита на серията, но защо да я хабиш?' : '';
  const stop = 'Не искаш тези писма? Спри напомнянията';
  return {
    to,
    subject: `🔥 Серията ти от ${streak} дни изтича довечера`,
    text: `Здравей, ${username}!\n\n${lead}${shield} Десет въпроса, две минути:\n${config.appUrl}/\n\n${stop}: ${unsubscribe.page}`,
    html: layout(
      `Здравей, ${username}!`,
      escapeHtml(`${lead}${shield} Десет въпроса, две минути.`),
      'Играй днешното',
      `${config.appUrl}/`,
      `${escapeHtml(stop)}: <a href="${unsubscribe.page}" style="color:#a78bfa">спри ги тук</a>.`,
    ),
    headers: { 'List-Unsubscribe': `<${unsubscribe.api}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}
