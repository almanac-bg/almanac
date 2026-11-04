import { useStore } from '@almanac/client';
import * as Linking from 'expo-linking';
import { type Href, router } from 'expo-router';
import { useEffect } from 'react';
import { create } from 'zustand';
import { hasScreen } from './links';

/**
 * Where a link meant to take someone who isn't signed in yet (a room's code from a teacher, a friend's challenge, a
 * group's invite): the guarded screens send them to the way in, so the link waits here until they're in.
 */
export const useEntry = create<{ path: string | null }>(() => ({ path: null }));

/**
 * A link's path in the app: „https://almanac.bg/join/123456“, „almanac://join/123456“ and a development build's
 * „exp://…/--/join/123456“ alike → „/join/123456“; one the app has no screen for, none. Read by hand: expo-linking's
 * parse looks for a development server first.
 */
export function pathOf(url: string): string | null {
  const m = /^([a-z][a-z\d+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(url);
  if (!m) return null;
  const [, scheme = '', host = '', rest = ''] = m;
  const dev = rest.indexOf('/--/');
  const path = dev >= 0 ? rest.slice(dev + 3) : /^https?$/i.test(scheme) ? rest : `/${host}${rest}`;
  const clean = path.replace(/\/+$/, '') || '/';
  return hasScreen(clean) ? clean : null;
}

/** What a waiting link is, for the way in to say: a room's code, or another kind of invitation. */
export function entryKind(path: string | null) {
  const room = path && /^\/join\/(\d+)$/.exec(path)?.[1];
  if (room) return { kind: 'room' as const, code: room };
  if (path && /^\/c\//.test(path)) return { kind: 'challenge' as const };
  if (path && /^\/groups\/join\//.test(path)) return { kind: 'group' as const };
  if (path && /^\/daily\/[^/]+$/.test(path)) return { kind: 'daily' as const };
  return null;
}

/**
 * A link opened while signed out is kept (useEntry), and opened once someone is in — a tick after, when the signed-in
 * screens are there to go to.
 */
export function useEntryLinks() {
  const url = Linking.useURL();
  const signedIn = useStore((s) => !!s.me);
  const waiting = useEntry((s) => s.path);
  useEffect(() => {
    if (signedIn || !url) return;
    const path = pathOf(url);
    if (path && path !== '/') useEntry.setState({ path });
  }, [url, signedIn]);
  useEffect(() => {
    if (!signedIn || !waiting) return;
    // Taken off the list when it opens: cleared any sooner, this effect would run again and call the opening off.
    const later = setTimeout(() => {
      useEntry.setState({ path: null });
      router.push(waiting as Href);
    }, 0);
    return () => clearTimeout(later);
  }, [signedIn, waiting]);
}
