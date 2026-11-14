// The whole UI layer: build elements with h(), keep state in signals, and let effects update exactly the nodes that
// show it. A screen builds its DOM once; nothing is diffed or re-rendered wholesale.

// ---- Ownership: everything an effect or a screen sets up is undone when its scope ends. ----

type Cleanup = () => void;

interface Scope {
  cleanups: Cleanup[];
}

let current: Scope | null = null;

/** Runs fn in a new scope; the returned dispose undoes everything set up inside it. */
export function scope<T>(fn: () => T): [T, () => void] {
  const s: Scope = { cleanups: [] };
  const parent = current;
  current = s;
  try {
    return [fn(), () => dispose(s)];
  } finally {
    current = parent;
  }
}

function dispose(s: Scope): void {
  const list = s.cleanups.splice(0);
  for (const fn of list.reverse()) fn();
}

/** Registers fn to run when the current scope ends. */
export function onCleanup(fn: Cleanup): void {
  current?.cleanups.push(fn);
}

// ---- Signals ----

interface Computation {
  run(): void;
  sources: Set<Set<Computation>>;
}

let tracking: Computation | null = null;
let batchDepth = 0;
const pending = new Set<Computation>();

export interface Signal<T> {
  (): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  /** The value without tracking it. */
  peek(): T;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const readers = new Set<Computation>();
  const read = (() => {
    if (tracking) {
      readers.add(tracking);
      tracking.sources.add(readers);
    }
    return value;
  }) as Signal<T>;
  read.peek = () => value;
  read.set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const c of [...readers]) pending.add(c);
    if (batchDepth === 0) flush();
  };
  read.update = (fn) => read.set(fn(value));
  return read;
}

/** Changes several signals; effects run once, after the last. */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    if (--batchDepth === 0) flush();
  }
}

const first = <T>(set: Set<T>): T | undefined => set.values().next().value;

function flush(): void {
  for (let c = first(pending); c; c = first(pending)) {
    pending.delete(c);
    c.run();
  }
}

/**
 * Runs fn now and again whenever a signal it read changes. What fn sets up (nested effects, cleanups) is undone
 * before each run and when the surrounding scope ends.
 */
export function effect(fn: () => void): void {
  let inner: (() => void) | null = null;
  const c: Computation = {
    sources: new Set(),
    run() {
      untrack(c);
      inner?.();
      const prev = tracking;
      tracking = c;
      try {
        [, inner] = scope(fn);
      } finally {
        tracking = prev;
      }
    },
  };
  onCleanup(() => {
    untrack(c);
    inner?.();
    pending.delete(c);
  });
  c.run();
}

function untrack(c: Computation): void {
  for (const readers of c.sources) readers.delete(c);
  c.sources.clear();
}

/** A value derived from signals, recomputed when they change. */
export function computed<T>(fn: () => T): () => T {
  const s = signal<T>(undefined as T);
  effect(() => s.set(fn()));
  return s;
}

/** Reads signals inside fn without making the current effect depend on them. */
export function untracked<T>(fn: () => T): T {
  const prev = tracking;
  tracking = null;
  try {
    return fn();
  } finally {
    tracking = prev;
  }
}

// ---- Elements ----

export type Child = Node | string | number | false | null | undefined | Child[] | (() => Child);

type Handler<E extends Event = Event> = (event: E) => void;
type Value = string | number | boolean | null | undefined;

export type Props = {
  [key: string]: Value | (() => Value) | Handler<never> | Record<string, string> | undefined;
} & {
  class?: string | (() => string);
  ref?: (el: HTMLElement) => void;
};

/**
 * Makes an element. Props set attributes (a function sets it again whenever the signals it reads change); `on…`
 * props add listeners; children may be nodes, text, arrays, or functions (re-run when their signals change).
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === "ref") (value as (el: HTMLElement) => void)(el);
      // Styles through the CSSOM: the page's CSP allows no style attributes.
      else if (key === "style" && typeof value === "object") {
        for (const [prop, v] of Object.entries(value as Record<string, string>)) el.style.setProperty(prop, v);
      } else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (typeof value === "function") {
        effect(() => setAttr(el, key, (value as () => Value)()));
      } else setAttr(el, key, value as Value);
    }
  }
  append(el, children);
  return el;
}

function setAttr(el: HTMLElement, key: string, value: Value): void {
  // Form state lives in properties, not attributes.
  if (key === "value" && "value" in el) {
    (el as HTMLInputElement).value = value == null ? "" : String(value);
    return;
  }
  if (key === "checked" || key === "disabled") {
    (el as HTMLInputElement)[key] = !!value;
    return;
  }
  // No handler from a string (they're functions, added as listeners), and no link anywhere but the web and mail.
  if (/^on/i.test(key)) throw new Error(`h(): ${key} must be a function`);
  if (urlAttributes.has(key.toLowerCase()) && typeof value === "string" && !safeURL(value)) {
    el.removeAttribute(key);
    return;
  }
  // ARIA states are the words "true" and "false"; other attributes are there or not.
  if (key.startsWith("aria-") && typeof value === "boolean") el.setAttribute(key, String(value));
  else if (value === false || value == null) el.removeAttribute(key);
  else el.setAttribute(key, value === true ? "" : String(value));
}

const urlAttributes = new Set(["href", "src", "srcset", "action", "formaction", "poster", "xlink:href"]);

/** A link to this site (or this page: #…), or to http(s) and mail: never javascript: or data: (srcset: each of its
 * addresses). */
export function safeURL(value: string): boolean {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .every((url) => {
      if ((url.startsWith("/") && !url.startsWith("//")) || url.startsWith("#")) return true;
      try {
        return ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
      } catch {
        return false;
      }
    });
}

/** Adds children to a parent node. */
export function append(parent: Node, children: Child[]): void {
  for (const child of children) parent.appendChild(toNode(child));
}

function toNode(child: Child): Node {
  if (child == null || child === false) return document.createTextNode("");
  if (child instanceof Node) return child;
  if (Array.isArray(child)) {
    const f = document.createDocumentFragment();
    append(f, child);
    return f;
  }
  if (typeof child === "function") return dynamic(child);
  return document.createTextNode(String(child));
}

/** A child that changes: text updates in place; anything else replaces what's between two markers. */
function dynamic(fn: () => Child): Node {
  const start = document.createTextNode("");
  const end = document.createTextNode("");
  const f = document.createDocumentFragment();
  f.append(start, end);
  let text: Text | null = null;
  effect(() => {
    const value = fn();
    if (typeof value === "string" || typeof value === "number") {
      if (text?.parentNode) {
        text.data = String(value);
        return;
      }
      text = document.createTextNode(String(value));
      clear(start, end);
      end.parentNode?.insertBefore(text, end);
      return;
    }
    text = null;
    const node = toNode(value);
    clear(start, end);
    end.parentNode?.insertBefore(node, end);
  });
  return f;
}

function clear(start: Node, end: Node): void {
  const parent = start.parentNode;
  if (!parent) return;
  while (start.nextSibling && start.nextSibling !== end) parent.removeChild(start.nextSibling);
}

/** Shows `then` while cond() is truthy, else `otherwise`. */
export function when(cond: () => unknown, then: () => Child, otherwise?: () => Child): () => Child {
  const on = computed(() => !!cond());
  return () => (on() ? untracked(then) : otherwise ? untracked(otherwise) : null);
}

/** A part of a screen whose view is set later: once a fetch is back, at each step of a game. */
export interface Slot {
  /** The view it shows now, as a child: put it where it goes (`h("div", null, slot)`). */
  (): Child;
  /** Shows the view `build` makes, in place of the last; built there, in a scope of its own. */
  show(build: () => Child): void;
}

/**
 * Makes a Slot. Each view is built inside the slot, so what it sets up (effects, timers, listeners) is undone when
 * the next view replaces it or the screen goes. A view built beforehand and put in a signal — after an await, where
 * no scope is open — would leave all of that running for good.
 */
export function slot(initial: () => Child = () => null): Slot {
  const view = signal(initial);
  const p = (() => {
    const build = view();
    return untracked(build);
  }) as Slot;
  p.show = (build) => view.set(build);
  return p;
}

/** Replaces what's in `root` with what view builds, in a scope of its own; returns its dispose. */
export function mount(root: Element, view: () => Child): () => void {
  const [node, dispose] = scope(() => toNode(view()));
  root.replaceChildren(node);
  return dispose;
}

/** Listens on a target for as long as the current scope lasts. */
export function listen<K extends keyof WindowEventMap>(
  target: Window | Document | HTMLElement,
  type: K,
  fn: (e: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, fn as EventListener, options);
  onCleanup(() => target.removeEventListener(type, fn as EventListener, options));
}
