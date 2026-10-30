import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND, ordinal, TIME_ZONE } from '@quiz/shared';
import nodemailer from 'nodemailer';
import { config } from './config';
import { reportError } from './monitoring';

export interface Mail {
  /** What it is (`reset`, `beaten`…): what a failed send reports — a subject can hold a player's name. */
  kind: string;
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
// smtp:// upgrades to TLS only if the server offers it: someone in between who hides the offer reads the login and
// every reset link. smtps:// (port 465) or ?requireTLS=true insists.
if (config.smtpUrl?.startsWith('smtp://') && !/[?&]requireTLS=true\b/.test(config.smtpUrl)) {
  console.warn('✉️  SMTP_URL is smtp:// without requireTLS=true: use smtps://…:465, or add ?requireTLS=true.');
}

/**
 * Sends in the background; failures are logged and reported (an expired SMTP key would otherwise stop every email
 * quietly), never surfaced to the requester. Logs and reports never contain addresses or links (they hold live
 * tokens) — except in development without SMTP, where the console stands in for the inbox.
 */
/** Every mail is sent by the site itself; an answer to it reaches us (Reply-To), which the footer says. */
const footerLine = () => `Писмото е изпратено автоматично от ${BRAND.domain}. Ако отговориш, писмото ти стига до нас.`;

export function sendMail(message: Mail) {
  const mail = {
    ...message,
    text: `${message.text}\n\n—\n${footerLine()}`,
    // An answer goes to a person, not to no-reply@; and out-of-office replies stay away from automatic mail.
    replyTo: config.operator.email,
    headers: { 'Auto-Submitted': 'auto-generated', ...message.headers },
  };
  if (config.mailOutbox) {
    fs.mkdirSync(config.mailOutbox, { recursive: true });
    const name = `${Date.now()}-${randomBytes(3).toString('hex')}.json`;
    fs.writeFileSync(path.join(config.mailOutbox, name), JSON.stringify(mail));
  }
  if (transport) {
    const { kind, ...message } = mail;
    transport.sendMail({ from: config.mailFrom, ...message }).catch((err) => {
      // A mail server's error can quote the recipient ("550 <x@y>: no such user"): never into a report.
      const why = String(err instanceof Error ? err.message : err).replace(/[^\s<>"@]+@[^\s<>"@]+/g, '<address>');
      void reportError(new Error(why), 'email', { extra: { kind } });
    });
  } else if (config.production) {
    console.warn(`✉️  Not sent (SMTP_URL not set): "${mail.subject}"`);
  } else if (!config.mailOutbox) {
    console.log(`✉️  (SMTP_URL not set) To: ${mail.to} — ${mail.subject}\n${mail.text}\n`);
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The HTML of every mail. Written for the mail apps, not browsers: every text cell names its own colour (Gmail drops
 * the <body>'s styles, and a greeting without one came out dark on dark), the card and the button are tables with
 * `bgcolor` and cell padding (Outlook's Word engine ignores a link's padding and a table's radius), and the footer is
 * light enough to read. `preheader`: the line inbox lists show after the subject (hidden in the mail itself).
 */
function layout(title: string, intro: string, button: string, link: string, outro: string, preheader = '') {
  const font = 'font-family:Arial,Helvetica,sans-serif';
  return `<!doctype html>
<html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#0b0915">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0b0915">${escapeHtml(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0915" style="background:#0b0915"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" bgcolor="#15122a" style="width:100%;max-width:480px;background:#15122a;border-radius:20px">
<tr><td style="padding:32px 32px 0;${font};font-size:26px;font-weight:900;letter-spacing:1px;color:#c4b5fd">${BRAND.name}⚡</td></tr>
<tr><td style="padding:20px 32px 0;${font};font-size:20px;font-weight:bold;color:#f5f3ff">${escapeHtml(title)}</td></tr>
<tr><td style="padding:12px 32px 0;${font};font-size:15px;line-height:1.6;color:#d4d0ea">${intro}</td></tr>
<tr><td style="padding:28px 32px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#7c3aed" style="background:#7c3aed;border-radius:14px">
<a href="${link}" style="display:inline-block;padding:14px 26px;${font};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:14px">${escapeHtml(button)}</a>
</td></tr></table></td></tr>
<tr><td style="padding:0 32px 32px;${font};font-size:13px;line-height:1.6;color:#b3aed0">${outro}<br><br>Ако бутонът не работи, отвори този линк:<br><a href="${link}" style="color:#c4b5fd;word-break:break-all">${link}</a></td></tr>
</table>
<p style="margin:16px 0 0;${font};font-size:12px;line-height:1.6;color:#a39fc0">${escapeHtml(footerLine())}</p>
</td></tr></table></body></html>`;
}

export function verifyEmailMail(to: string, username: string, link: string): Mail {
  return {
    kind: 'verify',
    to,
    subject: `Потвърди имейла си в ${BRAND.name}`,
    text: `Здравей, ${username}!\n\nПотвърди имейла си, за да можеш да възстановиш паролата си, ако я забравиш:\n${link}\n\nЛинкът е валиден 24 часа. Ако заявката не е от теб, просто игнорирай това писмо.`,
    html: layout(
      `Здравей, ${username}!`,
      'Потвърди имейла си, за да можеш да възстановиш паролата си, ако някога я забравиш.',
      'Потвърди имейла',
      link,
      'Линкът е валиден 24 часа. Ако заявката не е от теб, просто игнорирай това писмо.',
    ),
  };
}

/** To the previous address when a profile's email is changed or removed: the owner hears about it. */
export function emailChangedMail(to: string, username: string, removed: boolean): Mail {
  const what = removed ? 'Имейлът беше премахнат от профила ти' : 'Профилът ти вече използва друг имейл';
  // If someone else changed both the address and the password, there's no password left to change: we help.
  const advice = `Ако промяната не е от теб, отговори на това писмо веднага — ще ти помогнем да си върнеш профила.`;
  return {
    kind: 'email-changed',
    to,
    subject: `${what} в ${BRAND.name}`,
    text: `Здравей, ${username}!\n\n${what} (${BRAND.domain}). Това е последното писмо, което ще получиш на този адрес.\n\n${advice}`,
    html: layout(
      `Здравей, ${username}!`,
      `${what}. Това е последното писмо, което ще получиш на този адрес.`,
      'Към настройките',
      `${config.appUrl}/settings`,
      escapeHtml(advice),
    ),
  };
}

export function resetPasswordMail(to: string, username: string, link: string): Mail {
  return {
    kind: 'reset',
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
  // It goes out a month before the three years are up.
  const lead = `Профилът ти в ${BRAND.name} не е използван от почти три години. За да не пазим данни, които никой не ползва, на ${date} ще го изтрием заедно с нивото, статистиката и всичко изиграно.`;
  const keep = 'Искаш да го запазиш? Просто влез в профила си дотогава — нищо друго не е нужно.';
  return {
    kind: 'inactive',
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
  const lead = `Серията ти от ${streak} дни на „Въпросите на деня“ прекъсва в полунощ.`;
  const shield = shields > 0 ? ' Имаш и щит за серията, но защо да го хабиш?' : '';
  // Why this arrives: trust, and fewer spam marks.
  const stop = `Получаваш това писмо, защото напомнянията са включени в профила ти „${username}“. Не ги искаш?`;
  return {
    kind: 'streak',
    to,
    subject: `🔥 ${streak} дни подред — днешните 10 въпроса още те чакат`,
    text: `Здравей, ${username}!\n\n${lead}${shield} Десет въпроса, около три минути:\n${config.appUrl}/daily\n\n${stop} Спри напомнянията: ${unsubscribe.page}`,
    html: layout(
      `Здравей, ${username}!`,
      escapeHtml(`${lead}${shield} Десет въпроса, около три минути.`),
      'Играй днешните',
      `${config.appUrl}/daily`,
      `${escapeHtml(stop)} <a href="${unsubscribe.page}" style="color:#c4b5fd">Спри напомнянията</a>.`,
      'Около три минути — и серията продължава. Прекъсва в полунощ.',
    ),
    headers: { 'List-Unsubscribe': `<${unsubscribe.api}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

/**
 * Someone took the lead on the player's challenge link. Opt-in, at most one a day (challenges.ts), with the same
 * unsubscribe link and headers as the streak reminder (it stops both).
 */
export function beatenMail(
  to: string,
  username: string,
  beaten: { rival: string; score: number; place: number; link: string },
  unsubscribe: { page: string; api: string },
): Mail {
  const lead = `${beaten.rival} изигра предизвикателството ти и събра ${beaten.score} точки — вече си на ${ordinal(beaten.place)} място.`;
  const next = 'Виж класирането — или направи нов линк и си върни първото място.';
  const stop = `Получаваш това писмо, защото го включи в профила си „${username}“ — най-много едно на ден. Не го искаш?`;
  return {
    kind: 'beaten',
    to,
    subject: `⚔️ ${beaten.rival} те изпревари на линка ти`,
    text: `Здравей, ${username}!\n\n${lead} ${next}\n${beaten.link}\n\n${stop} Спри тези писма: ${unsubscribe.page}`,
    html: layout(
      `Здравей, ${username}!`,
      escapeHtml(`${lead} ${next}`),
      'Виж класирането',
      beaten.link,
      `${escapeHtml(stop)} <a href="${unsubscribe.page}" style="color:#c4b5fd">Спри тези писма</a>.`,
      `${beaten.score} точки на линка ти — можеш ли повече?`,
    ),
    headers: { 'List-Unsubscribe': `<${unsubscribe.api}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

export const longDateTime = (ts: number) =>
  new Intl.DateTimeFormat('bg-BG', { dateStyle: 'long', timeStyle: 'short', timeZone: TIME_ZONE }).format(ts);

/**
 * A moderator's decision, to the player it's about (statements.ts: what, on what basis and why, that a person decided,
 * and where to contest it), or to whoever reported (what came of it). The button contests it by mail, unless `button`
 * says otherwise.
 */
export function decisionMail(
  to: string,
  username: string,
  subject: string,
  lines: string[],
  button?: { label: string; link: string },
): Mail {
  const appeal = {
    label: 'Обжалвай решението',
    link: `mailto:${config.operator.email}?subject=${encodeURIComponent(`Обжалване – ${username}`)}`,
  };
  const { label, link } = button ?? appeal;
  return {
    kind: 'decision',
    to,
    subject,
    text: `Здравей, ${username}!\n\n${lines.join('\n\n')}\n\nУсловията за ползване: ${config.appUrl}/terms`,
    html: layout(
      `Здравей, ${username}!`,
      lines.map(escapeHtml).join('<br><br>'),
      label,
      link,
      `<a href="${config.appUrl}/terms" style="color:#c4b5fd">Условията за ползване</a>`,
      lines[0],
    ),
  };
}

/** To a moderator: something waits for them (`now`: an alert that can't wait for the morning summary). */
export function moderatorMail(to: string, subject: string, lines: string[], link: string): Mail {
  return {
    kind: 'moderators',
    to,
    subject,
    text: `${lines.join('\n')}\n\n${link}`,
    html: layout(subject, lines.map(escapeHtml).join('<br>'), 'Към модерацията', link, 'Писмо за модераторите.'),
  };
}
