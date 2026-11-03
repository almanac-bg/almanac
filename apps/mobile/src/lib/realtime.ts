import { connectRealtime, disconnectRealtime, useStore } from '@almanac/client';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * One realtime connection per signed-in session, as on the web (App.tsx), and a match that starts takes the screen
 * (a queue that pops, a room that starts, a reconnect into one: SignedIn.tsx).
 */
export function useRealtime() {
  const userId = useStore((s) => s.me?.id);
  useEffect(() => {
    if (!userId) return;
    void connectRealtime();
    return () => disconnectRealtime();
  }, [userId]);

  const gameId = useStore((s) => s.game?.start.gameId);
  const path = usePathname();
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (gameId && gameId !== last.current && path !== '/game') router.push('/game');
    last.current = gameId;
  }, [gameId, path]);
}
