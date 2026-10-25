import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND, LEGAL } from '@quiz/shared';
import nodemailer from 'nodemailer';
import { config } from './config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;
if (!transport && config.production) {
  console.warn('✉️  SMTP_URL is not set: password-reset and verification emails are not being sent.');
}

/**
 * Sends in the background; failures are logged, never surfaced to the requester. Logs never contain addresses or
 * links (they hold live tokens) — except in development without SMTP, where the console stands in for the inbox.
 */
export function sendMail(mail: Mail) {
  if (config.mailOutbox) {
    fs.mkdirSync(config.mailOutbox, { recursive: true });
    const name = `${Date.now()}-${randomBytes(3).toString('hex')}.json`;
    fs.writeFileSync(path.join(config.mailOutbox, name), JSON.stringify(mail));
  }
  if (transport) {
    transport
      .sendMail({ from: config.mailFrom, ...mail })
      .catch((err) => console.error(`✉️  Failed to send "${mail.subject}":`, err instanceof Error ? err.message : err));
  } else if (config.production) {
    console.warn(`✉️  Not sent (SMTP_URL not set): "${mail.subject}"`);
  } else if (!config.mailOutbox) {
    console.log(`✉️  (SMTP_URL not set) To: ${mail.to} — ${mail.subject}\n${mail.text}\n`);
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(title: string, intro: string, button: string, link: string, outro: string) {
  return `<!doctype html><html lang="bg"><body style="margin:0;background:#0b0915;font-family:Arial,Helvetica,sans-serif;color:#f5f3ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#15122a;border-radius:20px;padding:32px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:26px;font-weight:900;letter-spacing:1px;color:#c4b5fd">${BRAND.name}⚡</td></tr>
<tr><td style="padding-top:20px;font-size:20px;font-weight:bold">${escape(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#d4d0ea">${intro}</td></tr>
<tr><td style="padding:28px 0"><a href="${link}" style="display:inline-block;background:#8b5cf6;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:14px">${escape(button)}</a></td></tr>
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
  const advice = `Ако промяната не е от теб, смени паролата си веднага и ни пиши на ${LEGAL.email}.`;
  return {
    to,
    subject: `${what} в ${BRAND.name}`,
    text: `Здравей, ${username}!\n\n${what} (${BRAND.domain}). Затова това е последното писмо, което получаваш на този адрес.\n\n${advice}`,
    html: layout(
      `Здравей, ${username}!`,
      `${what}. Затова това е последното писмо, което получаваш на този адрес.`,
      'Към настройките',
      `${config.appUrl}/settings`,
      escape(advice),
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
