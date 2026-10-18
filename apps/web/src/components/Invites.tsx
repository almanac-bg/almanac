import type { Invite } from '@quiz/shared';
import { Swords, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useNow } from '../lib/hooks';
import { actions, dropInvite } from '../lib/socket';
import { toast, useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { Button } from './ui';

/** Incoming room invites and duel challenges from friends. */
export function Invites() {
  const invites = useStore((s) => s.invites);
  const inGame = useStore((s) => !!s.game && s.game.phase !== 'ended');
  if (inGame) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[55] flex flex-col items-center gap-3 px-4">
      <AnimatePresence>
        {invites.map((i) => (
          <InviteCard key={i.id} invite={i} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function InviteCard({ invite }: { invite: Invite }) {
  const navigate = useNavigate();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, Math.ceil((invite.expiresAt - now) / 1000));
  const challenge = invite.kind === 'challenge';

  async function accept() {
    setBusy(true);
    const res = await actions.joinRoom(invite.roomCode);
    setBusy(false);
    dropInvite(invite.id);
    if (res.ok) navigate('/room');
    else toast({ kind: 'error', title: res.error });
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.95 }}
      className="glass pointer-events-auto relative w-full max-w-md overflow-hidden rounded-3xl bg-ink-2/90 p-4 shadow-2xl"
    >
      <div
        className="absolute inset-x-0 top-0 h-0.5 origin-left bg-[linear-gradient(90deg,#e879f9,#22d3ee)] transition-transform duration-1000 ease-linear"
        style={{ transform: `scaleX(${left / 60})` }}
      />
      <div className="flex items-center gap-3">
        <Avatar avatar={invite.from.avatar} frame={invite.from.frame} size={48} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-fuchsia-300 uppercase">
            {challenge ? <Swords className="size-3.5" /> : <Users className="size-3.5" />}
            {challenge ? 'Предизвикателство' : 'Покана'}
          </p>
          <p className="truncate text-sm">
            <b>{invite.from.username}</b> {challenge ? 'те предизвиква на дуел!' : 'те кани в стая.'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => actions.declineInvite(invite)}>
          Откажи
        </Button>
        <Button size="sm" onClick={accept} loading={busy}>
          {challenge ? 'Приемам!' : 'Влез'} · {left}с
        </Button>
      </div>
    </motion.div>
  );
}
