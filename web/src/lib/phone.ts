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
 * the router's), the link that started the app too; Android's back button goes back a page (to Начало, if there's none
 * before), and from Начало puts the app away, as other apps do. */
export function start(go: (path: string) => void): void {
  app.on("appUrlOpen", (e: { url: string }) => open(e.url, go));
  app.call<{ url?: string } | undefined>("getLaunchUrl").then(
    (e) => e?.url && open(e.url, go),
    () => {},
  );
  // Android's own canGoBack leaves out pages opened without a tap (a notification's): back goes by the game's history.
  app.on("backButton", () => {
    if (location.pathname === "/") app.call("minimizeApp").catch(() => {});
    else if (history.length > 1) history.back();
    else go("/");
  });
  pushes.on("pushNotificationActionPerformed", (e: { notification: { data?: { url?: string } } }) => {
    if (e.notification?.data?.url) open(e.notification.data.url, go);
  });
}

/** Shares through the phone's share sheet (closing it without sharing is fine). */
export async function share(text: string, url?: string): Promise<void> {
  await plugin("Share")
    .call("share", { text, url })
    .catch(() => {});
}

/** A touch the player feels on an answer: one knock for right, a double for wrong. */
export function feel(kind: "exact" | "right" | "partial" | "wrong" | "time"): void {
  const type = kind === "exact" || kind === "right" ? "SUCCESS" : kind === "partial" ? "WARNING" : "ERROR";
  plugin("Haptics")
    .call("notification", { type })
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
