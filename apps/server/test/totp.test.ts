// One-time codes for staff (src/totp.ts): the RFC's own test vectors, a step either side, and each code once.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { base32, codeAt, fromBase32, otpauthUri, stepAt, verify } = await import('../src/totp');

// RFC 6238, appendix B: the SHA-1 key "12345678901234567890", eight digits.
const SECRET = base32(Buffer.from('12345678901234567890'));

test('codes match RFC 6238', () => {
  assert.equal(SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(fromBase32(SECRET).toString(), '12345678901234567890');
  for (const [seconds, code] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const)
    assert.equal(codeAt(SECRET, stepAt(seconds * 1000), 8), code, `at ${seconds}`);
});

test('a code works a step either side of now, and only once', () => {
  const now = 1_800_000_000_000;
  const step = stepAt(now);
  assert.equal(verify(SECRET, codeAt(SECRET, step), now), step);
  assert.equal(verify(SECRET, codeAt(SECRET, step - 1), now), step - 1, 'a phone a little behind');
  assert.equal(verify(SECRET, codeAt(SECRET, step + 1), now), step + 1, 'or ahead');
  assert.equal(verify(SECRET, codeAt(SECRET, step - 2), now), null, 'not a minute old');
  assert.equal(verify(SECRET, codeAt(SECRET, step), now, step), null, 'not twice');
  assert.equal(verify(SECRET, ` ${codeAt(SECRET, step).slice(0, 3)} ${codeAt(SECRET, step).slice(3)} `, now), step);
  assert.equal(verify(SECRET, 'abcdef', now), null);
  assert.match(otpauthUri('АЛМАНАХ', 'moderator', SECRET), /^otpauth:\/\/totp\/%D0%90.*\?secret=GEZD.*&issuer=/);
});
