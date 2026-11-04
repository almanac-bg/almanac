// What the site's and the app's third-party notices share (scripts/licenses.mjs, apps/mobile/scripts/licenses.mjs):
// a package's licence, read from the package itself.
import fs from 'node:fs';
import path from 'node:path';

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** A heading underlined, for a plain-text notices file. */
export const rule = (title) => `${title}\n${'='.repeat([...title].length)}\n`;

/**
 * The npm package in `dir`: its name and version, its licence's name (package.json's), and the texts of its licence
 * files — or, for a package that keeps them in its README (sharp's libvips build, a table of the libraries in it), that
 * section. None found: an empty list.
 */
export function readNotice(dir, entryLicence) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const files = fs
    .readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort();
  const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? entryLicence ?? 'see below');
  const texts = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim());
  const readme = fs.readdirSync(dir).find((f) => /^readme\.md$/i.test(f));
  if (!texts.length && readme) {
    const section = fs
      .readFileSync(path.join(dir, readme), 'utf8')
      .split(/^## /m)
      .find((part) => part.startsWith('Licensing'));
    if (section) texts.push(`## ${section.trim()}`);
  }
  return { name: pkg.name, version: pkg.version, licence, texts };
}
