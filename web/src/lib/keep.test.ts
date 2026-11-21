import assert from "node:assert/strict";
import { test } from "node:test";
import { askToKeep, keptWords, remindAnswered, remindAsks, remindShown } from "./keep.ts";

test("a guest is asked to keep their game from the second day, and at once in an app's own browser", () => {
  const guest = { days: 1, embedded: false };
  assert.equal(askToKeep(guest), false); // a first day: not yet
  assert.equal(askToKeep({ ...guest, days: 2 }), true);
  assert.equal(askToKeep({ ...guest, embedded: true }), true); // Messenger's browser: the first day
  assert.equal(askToKeep({ ...guest, days: 2, email: "a@b.bg" }), false); // kept already
  assert.equal(askToKeep({ ...guest, embedded: true, email: "a@b.bg" }), false);
});

test("the code put in says what came of it: a guest's game kept, or the profile it joined", () => {
  const guest = { id: 7, name: "Таралеж 123" };
  assert.equal(
    keptWords(guest, { ...guest, email: "ana@example.bg" }),
    "Готово. Играта ти е запазена с имейла ana@example.bg. Влизай с него на всяко устройство.",
  );
  const ana = { id: 3, name: "Ана", email: "ana@example.bg" };
  assert.equal(keptWords(guest, ana), "Влезе като Ана. Играта оттук е добавена към профила ти.");
  assert.equal(keptWords(null, ana), "Влезе като Ана.");
});

test("the reminder's asks: each way counted once a day, a refused notification's ask turned to mail counted too", () => {
  const day = "2026-11-18";
  let a = remindAsks(null);
  const push = remindShown(a, "push", day);
  assert.ok(push, "the notification's ask, counted");
  a = push;
  assert.equal(remindShown(a, "push", day), null, "once a day");
  const mail = remindShown(a, "mail", day);
  assert.ok(mail, "refused there and then: the ask by mail is counted as shown too");
  a = mail;
  assert.equal(remindShown(a, "mail", day), null);
  assert.ok(remindShown(a, "push", "2026-11-19"), "and again the next day");
  // As kept before each way counted apart: today's counted already, whichever it was.
  const old = remindAsks(JSON.stringify({ n: 1, day: "2026-11-17", shown: day }));
  assert.equal(remindShown(old, "mail", day), null);
  assert.equal(old.n, 1);
  assert.deepEqual(remindAsks("not json"), remindAsks(null));
});

test("„Не сега“ to the reminder by mail holds the ask to keep the game that day; a yes ends the asking", () => {
  const day = "2026-11-18";
  const a = remindAsks(null);
  const no = remindAnswered(a, "mail", day, false);
  assert.equal(no.mailNo, day);
  assert.equal(no.n, 1);
  assert.equal(no.day, day);
  assert.equal(remindAnswered(a, "push", day, false).mailNo, undefined, "a notification's „Не сега“ isn't the email's");
  assert.equal(remindAsks(JSON.stringify(no)).mailNo, day, "kept over a reload");
  assert.equal(remindAnswered(no, "mail", "2026-11-19", true).n, 3);
});
