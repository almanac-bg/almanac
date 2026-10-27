import { actions, toast, useStore } from '@quiz/client';
import { ROOM_CODE_DIGITS } from '@quiz/shared';
import clsx from 'clsx';
import { Lock, Plus, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { ClaimAccountModal } from '../ClaimAccount';
import { Button, Card } from '../ui';

export function FriendsCard({ className }: { className?: string }) {
  const navigate = useNavigate();
  const guest = useStore((s) => !!s.me?.isGuest);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [claiming, setClaiming] = useState(false);

  async function create() {
    setBusy('create');
    const res = await actions.createRoom();
    setBusy(null);
    if (res.ok) navigate('/room');
    else toast({ kind: 'error', title: res.error });
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (code.length !== ROOM_CODE_DIGITS) return;
    setBusy('join');
    const res = await actions.joinRoom(code);
    setBusy(null);
    if (res.ok) navigate('/room');
    else toast({ kind: 'error', title: res.error });
  }

  return (
    <Card className={clsx('relative flex flex-col overflow-hidden p-5 sm:p-7', className)}>
      <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-fuchsia-600/20 blur-3xl" />
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center gap-2 text-fuchsia-300">
          <Users className="size-5" />
          <span className="t-eyebrow">С приятели</span>
        </div>
        <h2 className="mt-2 t-card">Частна стая</h2>
        <p className="mt-1 text-sm text-fg-3">
          {guest
            ? 'До 8 играчи. Имаш код от приятел? Въведи го и влизаш в стаята.'
            : 'До 8 играчи, твои правила. Сподели кода и започвай.'}
        </p>
        {/* Beside a taller card (wide screens) the extra height goes here, so the actions sit at the bottom. */}
        <div className="flex-1" />
        {!guest && (
          <Button variant="secondary" className="mt-5 w-full" onClick={create} loading={busy === 'create'}>
            <Plus className="size-4" /> Създай стая
          </Button>
        )}
        <form onSubmit={join} className={clsx('flex gap-2', guest ? 'mt-5' : 'mt-3')}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, ROOM_CODE_DIGITS))}
            inputMode="numeric"
            placeholder="Код на стая"
            aria-label="Код на стая"
            className="field h-11 min-w-0 flex-1 rounded-2xl px-4 font-mono text-lg tracking-[0.3em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={code.length !== ROOM_CODE_DIGITS}
            loading={busy === 'join'}
          >
            Влез
          </Button>
        </form>
        {/* Guests can join a room but not open one: the button is still there, and on tap it says why. */}
        {guest && (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => setClaiming(true)}>
            <Lock className="size-4" /> Създай своя стая
          </Button>
        )}
      </div>
      {guest && (
        <ClaimAccountModal
          open={claiming}
          onClose={() => setClaiming(false)}
          reason="Свои стаи създават играчите с профил. Избери име и парола — нивото, серията и всичко изиграно досега остават твои."
        />
      )}
    </Card>
  );
}
