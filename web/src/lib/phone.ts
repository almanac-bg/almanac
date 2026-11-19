// What the game does through its app's bridge (app.ts says when): a file of its own, loaded only in the app, so a
// browser never downloads it. It imports nothing of the game's (what it needs comes as arguments): anything shared
// would go to a third file every player loads.
//
// The bridge the app puts on the page (Capacitor's native-bridge.js) is the bare one: a call to a plugin's method
// (nativePromise) and a callback for its events (nativeCallback). The usual registerPlugin is @capacitor/core's, an
// npm package the game doesn't ship; `plugin` below is the little of it the game needs.

// biome-ignore lint/suspicious/noExplicitAny: each event has its own data, as the plugin's own types say
type Data = any;

interface Bridge {
  getPlatform(): string;
  nativePromise<T>(plugin: string, method: string, options?: object): Promise<T>;
  nativeCallback(
    plugin: string,
    method: string,
    options: object,
    callback: (data: Data, error?: unknown) => void,
  ): string;
}

/** The game's API call (lib/api.ts's), handed in. */
type Call = (method: "DELETE" | "GET" | "PATCH" | "POST", path: string, body?: unknown) => Promise<unknown>;

const bridge = (globalThis as unknown as { Capacitor: Bridge }).Capacitor;
const platform = bridge.getPlatform();

/** A plugin of the app's (Capacitor's own: @capacitor/push-notifications and the rest, in mobile/package.json): its
 * methods called by name, and its events listened to (`on` gives back what stops listening). */
function plugin(name: string) {
  return {
    call: <T = void>(method: string, options: object = {}) => bridge.nativePromise<T>(name, method, options),
    on(event: string, fn: (data: Data) => void): () => void {
      const id = bridge.nativeCallback(name, "addListener", { eventName: event }, (data) => {
        if (data != null) fn(data);
      });
      return () => {
        bridge.nativePromise(name, "removeListener", { eventName: event, callbackId: id }).catch(() => {});
      };
    },
  };
}

const pushes = plugin("PushNotifications");
const app = plugin("App");

/** How the app gets around the game's pages (the router's, handed in): `navigate` opens a link from outside the page as
 * a tap on it would (a game under way asks first; a page of the server's own loads as a page); `go` opens a page of the
 * game's; `home` says whether Начало is showing with nothing under way on it (the day's ten are played on it);
 * `playing`, whether a game is under way; `canGoBack`, whether the page before is one of the game's; `resumed` hears of
 * the app brought back. */
export interface Nav {
  navigate: (link: string) => void;
  go: (path: string) => void;
  home: () => boolean;
  playing: () => boolean;
  canGoBack: () => boolean;
  resumed: () => void;
}

/** The link opened last, and when: one the phone tells of twice at once opens once. */
let last = { link: "", at: 0 };

/** Opens a link to the game (a notification's, or one opened in the app): only the game's own site. The page showing
 * now, with a game under way on it (a Роял reminder tapped in Роял), stays as it is. */
export function open(link: string, nav: Pick<Nav, "navigate" | "playing">): void {
  let u: URL;
  try {
    u = new URL(link, location.origin);
  } catch {
    return; // not a link: nothing to open
  }
  if (u.origin !== location.origin) return;
  const now = Date.now();
  if (u.href === last.link && now - last.at < 3_000) return;
  last = { link: u.href, at: now };
  if (nav.playing() && u.pathname + u.search === location.pathname + location.search) return;
  nav.navigate(u.href);
}

/** What Android's back button does: a sheet open over the page (a game's news, the name asked for: `sheet`) is put
 * away, as back does in the phone's own apps; from Начало, it puts the app away, as other apps do; else back a page (a
 * game under way asks first: router.ts), or, with no page of the game's before it, to Начало. */
export function backAction(nav: Pick<Nav, "home" | "canGoBack">, sheet = false): "close" | "away" | "back" | "home" {
  if (sheet) return "close";
  if (nav.home()) return "away";
  return nav.canGoBack() ? "back" : "home";
}

/** Starts what the app adds to the game: a tapped notification and a link to the game go to their page (open), the
 * link that started the app too (the app keeps its appUrlOpen until it's listened to; asking for the launch's link as
 * well would open it twice, and again at each reload after, the app keeping that link for good); Android's back button
 * does what backAction says; the app brought back is told (`nav.resumed`). `opened` hears of a notification tapped, by
 * its kind. */
export function start(nav: Nav, opened: (kind: string) => void): void {
  app.on("appUrlOpen", (e: { url: string }) => open(e.url, nav));
  // Android's own canGoBack leaves out pages opened without a tap (a notification's): back goes by the game's history.
  app.on("backButton", () => {
    const sheet = document.querySelector<HTMLDialogElement>("dialog[open]");
    const what = backAction(nav, !!sheet);
    if (what === "close") sheet?.close();
    else if (what === "away") app.call("minimizeApp").catch(() => {});
    else if (what === "back") history.back();
    else nav.go("/");
  });
  app.on("resume", () => nav.resumed());
  pushes.on("pushNotificationActionPerformed", (e: { notification: { data?: { url?: string; kind?: string } } }) => {
    const data = e.notification?.data;
    if (data?.kind) opened(data.kind);
    if (data?.url) open(data.url, nav);
  });
}

/** Sends a link through the phone's share sheet (a room's: screens/room.ts). The sheet closed without sending is
 * answered with a refusal, which is nothing to say. */
export async function share(text: string, url: string): Promise<void> {
  await plugin("Share")
    .call("share", { text, url })
    .catch(() => {});
}

/** What the player feels: a light knock for a tap (and for close, and a Роял cut out), a selection tick for each digit
 * or move, a medium knock for right and the streak, success for exact, two light knocks for wrong (never the phone's
 * ERROR, a sharp alert felt several times a day), and success then a heavy knock for the big moments. */
export function haptic(kind: "tap" | "select" | "right" | "exact" | "close" | "wrong" | "streak" | "big"): void {
  const touch = plugin("Haptics");
  const call = (method: string, options: object = {}) => touch.call(method, options).catch(() => {});
  const knock = (style: "LIGHT" | "MEDIUM" | "HEAVY", after = 0) =>
    after ? setTimeout(() => call("impact", { style }), after) : call("impact", { style });
  if (kind === "tap" || kind === "close") knock("LIGHT");
  else if (kind === "select") call("selectionStart").then(() => call("selectionChanged"));
  else if (kind === "right" || kind === "streak") knock("MEDIUM");
  else if (kind === "exact") call("notification", { type: "SUCCESS" });
  else if (kind === "wrong") {
    knock("LIGHT");
    knock("LIGHT", 80);
  } else {
    call("notification", { type: "SUCCESS" });
    knock("HEAVY", 120);
  }
}

// The phone's token while notifications are on (kept on the phone), so that turning them off can say which.
const tokenKey = "almanac.phone";

function stored(): string | null {
  try {
    return localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}

function store(token: string | null): void {
  try {
    if (token) localStorage.setItem(tokenKey, token);
    else localStorage.removeItem(tokenKey);
  } catch {
    // a phone without storage asks again next time
  }
}

/** The phone's token from its push service, asked for anew (the phone has one ready, unless it's the first time). */
function token(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      offToken();
      offError();
    };
    const offToken = pushes.on("registration", (t: { value: string }) => {
      stop();
      resolve(t.value);
    });
    const offError = pushes.on("registrationError", (e: { error: string }) => {
      stop();
      reject(new Error(e.error));
    });
    pushes.call("register").catch((err) => {
      stop();
      reject(err);
    });
  });
}

const allowed = async (ask: boolean) =>
  (await pushes.call<{ receive: string }>(ask ? "requestPermissions" : "checkPermissions")).receive === "granted";

/** Whether notifications are on in the app here; if so, the server is told the phone's token again (it can change). */
export async function pushOn(call: Call): Promise<boolean> {
  if (!stored()) return false;
  if (!(await allowed(false))) {
    store(null); // turned off in the phone's settings
    return false;
  }
  token()
    .then((t) => {
      store(t);
      return call("POST", "/api/push/phone", { platform, token: t });
    })
    .catch(() => {});
  return true;
}

/** Turns notifications on (the phone asks the player), or says why not. */
export async function turnOn(call: Call): Promise<string | null> {
  if (!(await allowed(true))) {
    return "Телефонът не позволи известия. Можеш да ги разрешиш от настройките на телефона за АЛМАНАХ.";
  }
  const t = await token();
  await call("POST", "/api/push/phone", { platform, token: t });
  store(t);
  return null;
}

export async function turnOff(call: Call): Promise<void> {
  const t = stored();
  store(null);
  if (t) await call("DELETE", "/api/push/phone", { token: t }).catch(() => {});
}
