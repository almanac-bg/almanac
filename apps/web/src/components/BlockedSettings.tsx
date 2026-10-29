import { api, errorMessage, toast } from '@quiz/client';
import type { PublicUser } from '@quiz/shared';
import { Ban } from 'lucide-react';
import { useState } from 'react';
import { useLoad } from '../lib/load';
import { Avatar } from './Avatar';
import { PlayerName } from './FitName';
import { Button, Card } from './ui';

/** Settings → the players this one blocked (they can't send a friend request), each a tap from unblocking. */
export function BlockedSettings() {
  const { data, setData } = useLoad(() => api.blocked());
  const [busy, setBusy] = useState<number | null>(null);
  const players: PublicUser[] = data?.players ?? [];
  if (!players.length) return null;

  async function unblock(p: PublicUser) {
    setBusy(p.id);
    try {
      setData(await api.unblock(p.id));
      toast({ kind: 'info', title: `${p.username} вече не е блокиран профил` });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Ban className="size-5 text-fg-3" />
        <h2 className="t-card">Блокирани</h2>
      </div>
      <p className="mt-2 text-sm text-fg-2">Не могат да ти пращат покани за приятелство, нито ти на тях.</p>
      <ul className="mt-4 divide-y divide-line">
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2.5">
            <Avatar avatar={p.avatar} frame={p.frame} size={36} />
            <PlayerName name={p.username} className="flex-1 font-semibold" />
            <Button size="sm" variant="ghost" onClick={() => unblock(p)} loading={busy === p.id}>
              Отблокирай
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
