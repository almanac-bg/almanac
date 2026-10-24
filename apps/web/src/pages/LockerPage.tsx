import {
  AVATARS,
  EMOTES,
  FRAMES,
  type Loadout,
  meetsRequirement,
  POWERUPS,
  type Requirement,
  TITLES,
  titleName,
} from '@quiz/shared';
import clsx from 'clsx';
import { Check, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { Avatar, LevelBadge } from '../components/Avatar';
import { Card, Segmented } from '../components/ui';
import { api, requirementLabel, setState, toast, unlockContextOf, useStore } from '@quiz/client';

type Tab = 'avatar' | 'frame' | 'title' | 'emote' | 'powerup';

export function LockerPage() {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<Tab>('avatar');
  const [saving, setSaving] = useState<string | null>(null);
  const ctx = unlockContextOf(me);
  const level = ctx.level;
  const unlocked = (req: Requirement) => meetsRequirement(req, ctx);

  async function equip(patch: Partial<Loadout>) {
    const key = Object.values(patch)[0]!;
    setSaving(key);
    setState({ me: { ...me, ...patch } });
    try {
      const { user } = await api.loadout(patch);
      setState({ me: user });
    } catch (e) {
      setState({ me });
      toast({ kind: 'error', title: e instanceof Error ? e.message : 'Неуспешно запазване.' });
    } finally {
      setSaving(null);
    }
  }

  const counts: Record<Tab, [number, number]> = {
    avatar: [AVATARS.filter((a) => unlocked(a.req)).length, AVATARS.length],
    frame: [FRAMES.filter((a) => unlocked(a.req)).length, FRAMES.length],
    title: [TITLES.filter((a) => unlocked(a.req)).length, TITLES.length],
    emote: [EMOTES.filter((a) => unlocked(a.req)).length, EMOTES.length],
    powerup: [POWERUPS.filter((a) => unlocked(a.req)).length, POWERUPS.length],
  };
  const label = (t: Tab, name: string) => (
    <>
      {name} <span className="text-fg-3">{counts[t][0]}/{counts[t][1]}</span>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="relative flex flex-col items-center overflow-hidden p-8 text-center lg:sticky lg:top-24 lg:self-start">
          <div className="absolute -top-20 size-64 rounded-full bg-violet-600/30 blur-3xl" />
          <motion.div key={`${me.avatar}-${me.frame}`} initial={{ scale: 0.85, rotate: -6 }} animate={{ scale: 1, rotate: 0 }}>
            <Avatar avatar={me.avatar} frame={me.frame} size={140} className="relative" />
          </motion.div>
          <h1 className="relative mt-5 flex items-center gap-2 font-display text-2xl font-bold">
            {me.username} <LevelBadge level={level} />
          </h1>
          <p className="relative mt-1 font-semibold text-violet-300">{titleName(me.title)}</p>
          <p className="relative mt-4 text-sm text-fg-3">Така те виждат другите играчи в лобито и по време на игра.</p>
        </Card>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-bold">Колекция</h2>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'avatar', label: label('avatar', 'Аватари') },
                { value: 'frame', label: label('frame', 'Рамки') },
                { value: 'title', label: label('title', 'Титли') },
                { value: 'emote', label: label('emote', 'Емоции') },
                { value: 'powerup', label: label('powerup', 'Жокери') },
              ]}
            />
          </div>

          {tab === 'avatar' && (
            <Grid>
              {AVATARS.map((a) => (
                <Item
                  key={a.id}
                  name={a.name}
                  req={a.req}
                  unlocked={unlocked(a.req)}
                  equipped={me.avatar === a.id}
                  saving={saving === a.id}
                  onEquip={() => equip({ avatar: a.id })}
                >
                  <Avatar avatar={a.id} frame={me.frame} size={64} />
                </Item>
              ))}
            </Grid>
          )}
          {tab === 'frame' && (
            <Grid>
              {FRAMES.map((f) => (
                <Item
                  key={f.id}
                  name={f.name}
                  req={f.req}
                  unlocked={unlocked(f.req)}
                  equipped={me.frame === f.id}
                  saving={saving === f.id}
                  onEquip={() => equip({ frame: f.id })}
                >
                  <Avatar avatar={me.avatar} frame={f.id} size={64} />
                </Item>
              ))}
            </Grid>
          )}
          {tab === 'title' && (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {TITLES.map((t) => {
                const open = unlocked(t.req);
                const equipped = me.title === t.id;
                return (
                  <button
                    key={t.id}
                    disabled={!open || equipped}
                    onClick={() => equip({ title: t.id })}
                    className={clsx(
                      'focus-ring glass flex items-center justify-between gap-3 rounded-2xl p-4 text-left transition-colors',
                      open && !equipped && 'hover:bg-white/10',
                      equipped && 'border-violet-400/60 bg-violet-500/15',
                      !open && 'opacity-55',
                    )}
                  >
                    <span>
                      <span className="block font-semibold">{t.name}</span>
                      <span className="text-xs text-fg-3">{open ? (equipped ? 'Избрана' : 'Избери') : requirementLabel(t.req)}</span>
                    </span>
                    {equipped ? <Check className="size-5 text-violet-300" /> : !open && <Lock className="size-4 text-fg-3" />}
                  </button>
                );
              })}
            </div>
          )}
          {tab === 'emote' && (
            <>
              <p className="text-sm text-fg-3">Емоциите се използват по време на мултиплейър мачове — всички отключени са винаги под ръка.</p>
              <Grid>
                {EMOTES.map((e) => (
                  <Item key={e.id} name="" req={e.req} unlocked={unlocked(e.req)}>
                    <span className="text-5xl">{e.emoji}</span>
                  </Item>
                ))}
              </Grid>
            </>
          )}
          {tab === 'powerup' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {POWERUPS.map((p) => {
                const open = unlocked(p.req);
                return (
                  <Card key={p.id} className={clsx('p-5', !open && 'opacity-60')}>
                    <div className="flex items-center gap-3">
                      <span className="grid size-12 place-items-center rounded-2xl bg-amber-400/15 text-2xl">🃏</span>
                      <div>
                        <div className="font-display font-bold">{p.name}</div>
                        <div className="text-xs text-fg-3">{open ? 'Отключен · веднъж на мач' : requirementLabel(p.req)}</div>
                      </div>
                      {!open && <Lock className="ml-auto size-4 text-fg-3" />}
                    </div>
                    <p className="mt-3 text-sm text-fg-2">{p.description}</p>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 xl:grid-cols-6">{children}</div>;
}

function Item({
  name,
  req,
  unlocked,
  equipped,
  saving,
  onEquip,
  children,
}: {
  name: string;
  req: Requirement;
  unlocked: boolean;
  equipped?: boolean;
  saving?: boolean;
  onEquip?: () => void;
  children: ReactNode;
}) {
  const clickable = unlocked && !equipped && !!onEquip;
  return (
    <motion.button
      whileHover={clickable ? { y: -3 } : undefined}
      whileTap={clickable ? { scale: 0.96 } : undefined}
      disabled={!clickable}
      onClick={onEquip}
      title={unlocked ? name : `${name} — ${requirementLabel(req)}`}
      className={clsx(
        'focus-ring glass relative flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center',
        equipped && 'border-violet-400/70 bg-violet-500/15 shadow-[0_0_24px_-8px_rgb(139_92_246/0.9)]',
        clickable && 'hover:bg-white/10',
        saving && 'animate-pulse',
      )}
    >
      <span className={clsx(!unlocked && 'opacity-30 grayscale')}>{children}</span>
      {name && <span className="w-full truncate text-xs font-semibold">{name}</span>}
      {!unlocked && (
        <span className="flex max-w-full items-center gap-1 text-[10px] leading-tight text-fg-3">
          {'level' in req && <Lock className="size-3 shrink-0" />}
          <span className="truncate">{requirementLabel(req, true)}</span>
        </span>
      )}
      {equipped && (
        <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-violet-500">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </motion.button>
  );
}
