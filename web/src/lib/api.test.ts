// Talking to the server, against a fetch stood in for: what an answer becomes, and what is sent again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, api, errorText, hearing, passing, serverNow, tries } from "./api.ts";

// The page the reports name (lib/errors.ts sends none without one).
(globalThis as { location?: unknown }).location = { pathname: "/" };

/** The problems the page reported (POST /api/errors), as sent. */
let reported: { message: string }[] = [];
const sent = () => {
  reported = [];
  return reported;
};

/** The server stood in for: each call takes the next answer (a Response, or "down" for no line); a problem reported
 * is kept (sent) and takes none. */
function serve(...answers: (Response | "down")[]): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    asked.push(`${init.method} ${path}`);
    if (path === "/api/errors") {
      reported.push(JSON.parse(String(init.body)));
      return new Response("{}");
    }
    const a = answers.shift() ?? "down";
    if (a === "down") throw new TypeError("Failed to fetch");
    return a;
  }) as typeof fetch;
  return asked;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("an answer is its JSON; an error, the server's words for it; no line, the line's", async () => {
  serve(json(200, { day: "2026-11-17" }), json(404, { error: "no_run", message: "Няма такава игра." }), "down");
  assert.deepEqual(await api("GET", "/api/day"), { day: "2026-11-17" });
  await assert.rejects(api("GET", "/api/runs/1"), { name: "ApiError", code: "no_run", status: 404 });
  await assert.rejects(api("GET", "/api/day"), (e: ApiError) => e.code === "offline" && e.status === 0);
});

test("a 2xx that isn't JSON (not the API's) is an error, not null, and reported with what it was", async () => {
  const asked = serve(new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
  const reports = sent();
  await assert.rejects(api("GET", "/api/day"), (e: ApiError) => e instanceof ApiError && e.code === "server");
  assert.deepEqual(asked, ["GET /api/day", "POST /api/errors"]);
  assert.equal(reports[0]?.message, "GET /api/day: 200 without JSON (text/html, 18 characters)");
});

test("an answer cut off on its way (a page reloaded under it) is the line's, and not reported", async () => {
  // Its headers came, its body never whole: the browser stopped reading it, as a reload or a stop does.
  const cut = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"waiting":'));
      c.error(new TypeError("Failed to fetch"));
    },
  });
  const asked = serve(new Response(cut, { status: 200, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(api("GET", "/api/day"), (e: ApiError) => e.code === "offline" && e.status === 0);
  assert.deepEqual(asked, ["GET /api/day"]);
});

test("the player is told an ApiError's words, and a plain Bulgarian line for anything else", () => {
  assert.equal(errorText(new ApiError("no_run", "Няма такава игра.", 404)), "Няма такава игра.");
  assert.equal(
    errorText(new TypeError("Cannot read properties of null (reading 'day')")),
    "Нещо се обърка. Опитай пак.",
  );
  assert.equal(passing(new ApiError("offline", "")), true);
  assert.equal(passing(new ApiError("server", "", 503)), true);
  assert.equal(passing(new ApiError("no_run", "", 404)), false);
});

test("every answer is heard: the version on it, and an error's code", async () => {
  const heard: string[] = [];
  hearing.push((res, code) => heard.push(`${res.headers.get("X-Almanac-Version")} ${code}`));
  serve(
    json(200, {}, { "X-Almanac-Version": "v3.1.0" }),
    json(401, { error: "signed_out" }, { "X-Almanac-Version": "v3.1.0" }),
  );
  await api("GET", "/api/me");
  await api("GET", "/api/friends").catch(() => {});
  hearing.pop();
  assert.deepEqual(heard, ["v3.1.0 ", "v3.1.0 signed_out"]);
});

test("the server's clock, from its answers: a phone's a day off is set right, one a second off is taken as right", async () => {
  const day = 24 * 3600_000;
  serve(json(200, {}, { Date: new Date(Date.now() - day).toUTCString() }));
  await api("GET", "/api/day");
  assert.ok(Math.abs(serverNow() - (Date.now() - day)) < 2000);
  serve(json(200, {}, { Date: new Date(Date.now() + 1000).toUTCString() }));
  await api("GET", "/api/day");
  assert.ok(Math.abs(serverNow() - Date.now()) < 5);
});

test("a game's step is tried three times while the line or the server is down, and not again after a „no“", async () => {
  let asked = serve("down", json(503, {}), json(200, { at: 3 }));
  assert.deepEqual(await tries(() => api("POST", "/api/runs/1/show"), { pause: 1 }), { at: 3 });
  assert.equal(asked.length, 3);
  asked = serve("down", "down", "down", json(200, {}));
  await assert.rejects(
    tries(() => api("POST", "/api/runs/1/show"), { pause: 1 }),
    { code: "offline" },
  );
  assert.equal(asked.length, 3);
  asked = serve(json(409, { error: "out_of_step" }), json(200, {}));
  await assert.rejects(
    tries(() => api("POST", "/api/runs/1/answer"), { pause: 1 }),
    { code: "out_of_step" },
  );
  assert.equal(asked.length, 1);
});

test("an answer is sent again while it doesn't get through and its question is open, and not after", async () => {
  const send = () => api("POST", "/api/runs/1/answer", {});
  const live = (open: () => boolean) => tries(send, { open, pause: 1, max: Number.POSITIVE_INFINITY });
  let asked = serve("down", json(502, {}), "down", json(200, { ok: true }));
  assert.deepEqual(await live(() => true), { ok: true });
  assert.equal(asked.length, 4);
  // A „no“ of the server's (too late) ends it at once.
  asked = serve(json(409, { error: "not_now", message: "Вече е късно за това." }));
  await assert.rejects(
    live(() => true),
    { code: "not_now" },
  );
  assert.equal(asked.length, 1);
  // The question gone meanwhile: no more sends.
  let open = 2;
  asked = serve("down", "down", "down", "down");
  await assert.rejects(
    live(() => --open > 0),
    { code: "offline" },
  );
  assert.equal(asked.length, 2);
});
