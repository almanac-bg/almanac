// What the game does through its app's bridge (app.ts says when): a file of its own, loaded only in the app, so a
// browser never downloads it. It imports nothing of the game's (what it needs comes as arguments): anything shared
// would go to a third file every player loads.

interface Bridge {
  getPlatform(): string;
  registerPlugin<T>(name: string): T;
}

interface Listening {
  remove(): Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: each event has its own data, as the plugin's own types say
type On = (event: string, fn: (data: any) => void) => Promise<Listening>;

interface PushPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener: On;
}

interface AppPlugin {
  addListener: On;
  getLaunchUrl(): Promise<{ url: string } | undefined>;
  minimizeApp(): Promise<void>;
}

interface SharePlugin {
  share(o: { text?: string; url?: string }): Promise<void>;
}

interface HapticsPlugin {
  notification(o: { type: "SUCCESS" | "WARNING" | "ERROR" }): Promise<void>;
}

/** The game's API call (lib/api.ts's), handed in. */
type Call = (method: "DELETE" | "GET" | "PATCH" | "POST", path: string, body?: unknown) => Promise<unknown>;

const bridge = (globalThis as unknown as { Capacitor: Bridge }).Capacitor;
const platform = bridge.getPlatform();
// Plugins of the app's (Capacitor's own: @capacitor/push-notifications and the rest, in mobile/package.json).
const pushes = bridge.registerPlugin<PushPlugin>("PushNotifications");
const app = bridge.registerPlugin<AppPlugin>("App");

/** Goes to a link to the game (a notification's, or one opened in the app): only the game's own pages. */
function open(link: string, go: (path: string) => void): void {
  try {
    const u = new URL(link, location.origin);
    if (u.origin === location.origin) go(u.pathname + u.search + u.hash);
  } catch {
    // not a link: nothing to open
  }
}

/** Starts what the app adds to the game: a tapped notification and a link to the game go to their page (by `go`,
 * the router's), the link that started the app too; Android's back button goes back a page, and from Начало puts the
 * app away, as other apps do. */
export function start(go: (path: string) => void): void {
  app.addListener("appUrlOpen", (e: { url: string }) => open(e.url, go));
  app.getLaunchUrl().then(
    (e) => e?.url && open(e.url, go),
    () => {},
  );
  app.addListener("backButton", (e: { canGoBack: boolean }) => {
    if (e.canGoBack && location.pathname !== "/") history.back();
    else app.minimizeApp();
  });
  pushes.addListener("pushNotificationActionPerformed", (e: { notification: { data?: { url?: string } } }) => {
    if (e.notification.data?.url) open(e.notification.data.url, go);
  });
}

/** Shares through the phone's share sheet (closing it without sharing is fine). */
export async function share(text: string, url?: string): Promise<void> {
  await bridge
    .registerPlugin<SharePlugin>("Share")
    .share({ text, url })
    .catch(() => {});
}

/** A touch the player feels on an answer: one knock for right, a double for wrong. */
export function feel(kind: "exact" | "right" | "partial" | "wrong" | "time"): void {
  const type = kind === "exact" || kind === "right" ? "SUCCESS" : kind === "partial" ? "WARNING" : "ERROR";
  bridge
    .registerPlugin<HapticsPlugin>("Haptics")
    .notification({ type })
    .catch(() => {});
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
    const listening = [
      pushes.addListener("registration", (t: { value: string }) => {
        for (const l of listening) l.then((x) => x.remove());
        resolve(t.value);
      }),
      pushes.addListener("registrationError", (e: { error: string }) => {
        for (const l of listening) l.then((x) => x.remove());
        reject(new Error(e.error));
      }),
    ];
    pushes.register().catch(reject);
  });
}

/** Whether notifications are on in the app here; if so, the server is told the phone's token again (it can change). */
export async function pushOn(call: Call): Promise<boolean> {
  if (!stored()) return false;
  if ((await pushes.checkPermissions()).receive !== "granted") {
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
  if ((await pushes.requestPermissions()).receive !== "granted") {
    return "Телефонът не позволи известия. Може да ги разрешиш от настройките му за АЛМАНАХ.";
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
