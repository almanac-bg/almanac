import { api, errorMessage, fmt, requirementLabel, setState, toast, unlockContextOf, useStore } from '@quiz/client';
import {
  ACHIEVEMENTS,
  AVATARS,
  CATEGORIES,
  EMOTES,
  FRAMES,
  type Loadout,
  MASTERY_TIERS,
  masteryTitleId,
  meetsRequirement,
  POWERUPS,
  type Requirement,
  TITLES,
  type TitleDef,
  titleName,
  xpToReach,
} from '@quiz/shared';
import clsx from 'clsx';
import { Check, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { Avatar, LevelBadge } from '../components/Avatar';
import { Emoji } from '../components/Emoji';
import { KeyHint, POWERUP_KEYS } from '../components/game/Powerups';
import { Card, Modal, ProgressBar, Segmented } from '../components/ui';
import { useLoad } from '../lib/load';
import { useMediaQuery } from '../lib/media';
import { usePageTitle } from '../lib/title';

type Tab = 'avatar' | 'frame' | 'title' | 'emote' | 'powerup';

export function LockerPage() {
  usePageTitle('Колекция');
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<Tab>('avatar');
  const [saving, setSaving] = useState<string | null>(null);
  const ctx = unlockContextOf(me);
  const level = ctx.level;
  const unlocked = (req: Requirement) => meetsRequirement(req, ctx);
  const wide = useMediaQuery('(min-width: 1024px)');

  async function equip(patch: Partial<Loadout>) {
    const key = Object.values(patch)[0]!;
    setSaving(key);
    setState({ me: { ...me, ...patch } });
    try {
      const { user } = await api.loadout(patch);
      setState({ me: user });
    } catch (e) {
      setState({ me });
      toast({ kind: 'error', title: errorMessage(e, 'Неуспешно запазване.') });
    } finally {
      setSaving(null);
    }
  }

  // Козове aren't collected: everyone has them all, so their tab has no count.
  const counts: Record<Exclude<Tab, 'powerup'>, [number, number]> = {
    avatar: [AVATARS.filter((a) => unlocked(a.req)).length, AVATARS.length],
    frame: [FRAMES.filter((a) => unlocked(a.req)).length, FRAMES.length],
    title: [TITLES.filter((a) => unlocked(a.req)).length, TITLES.length],
    emote: [EMOTES.filter((a) => unlocked(a.req)).length, EMOTES.length],
  };
  const label = (t: Exclude<Tab, 'powerup'>, name: string) => (
    <>
      {name} {/* Brighter on the chosen tab: muted grey on its lighter fill was under 4.5:1. */}
      <span className="text-fg-3 in-aria-pressed:text-fg-2">
        {counts[t][0]}/{counts[t][1]}
      </span>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Phones: one row (avatar beside the name), so the collection itself starts on the first screen. */}
        <Card className="relative flex items-center gap-4 overflow-hidden p-4 lg:sticky lg:top-24 lg:flex-col lg:gap-0 lg:self-start lg:p-8 lg:text-center">
          <div className="absolute -top-20 size-64 rounded-full glow text-violet-600/30" />
          <motion.div
            key={`${me.avatar}-${me.frame}`}
            initial={{ scale: 0.85, rotate: -6 }}
            animate={{ scale: 1, rotate: 0 }}
            className="shrink-0"
          >
            <Avatar avatar={me.avatar} frame={me.frame} size={wide ? 140 : 72} className="relative" />
          </motion.div>
          <div className="relative min-w-0">
            <h1 className="flex items-center gap-2 t-section lg:mt-5 lg:justify-center">
              <span className="truncate">{me.username}</span> <LevelBadge level={level} />
            </h1>
            <p className="mt-1 font-semibold text-violet-300">{titleName(me.title)}</p>
            <p className="mt-4 text-sm text-fg-3 max-lg:hidden">
              Така те виждат другите играчи в лобито и по време на игра.
            </p>
          </div>
        </Card>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="t-section">Колекция</h2>
            <Segmented
              scroll
              value={tab}
              onChange={setTab}
              options={[
                { value: 'avatar', label: label('avatar', 'Аватари') },
                { value: 'frame', label: label('frame', 'Рамки') },
                { value: 'title', label: label('title', 'Титли') },
                { value: 'emote', label: label('emote', 'Емоции') },
                { value: 'powerup', label: 'Козове' },
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
            <>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {TITLES.filter((t) => !('mastery' in t.req)).map((t) => (
                  <TitleButton
                    key={t.id}
                    title={t}
                    open={unlocked(t.req)}
                    equipped={me.title === t.id}
                    onEquip={() => equip({ title: t.id })}
                  />
                ))}
              </div>
              {/* A category's three tiers side by side: thirty titles in a list would bury the rest. */}
              <section aria-labelledby="mastery-titles" className="mt-8">
                <h2 id="mastery-titles" className="t-section">
                  Майсторство
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-fg-3">
                  Степен във всяка категория според това колко добре я знаеш спрямо останалите играчи (след поне 30
                  отговора в нея). Веднъж стигната, остава твоя.
                </p>
                <div className="mt-4 grid gap-2.5 lg:grid-cols-2">
                  {CATEGORIES.map((c) => (
                    <div key={c.id} className="glass rounded-2xl p-3">
                      <p className="px-1 text-sm font-semibold">
                        <Emoji e={c.icon} /> {c.name}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {MASTERY_TIERS.map((tier, i) => {
                          const t = TITLES.find((x) => x.id === masteryTitleId({ category: c.id, tier: i }))!;
                          return (
                            <TitleButton
                              key={t.id}
                              title={t}
                              label={tier.name}
                              icon={tier.icon}
                              open={unlocked(t.req)}
                              equipped={me.title === t.id}
                              onEquip={() => equip({ title: t.id })}
                              compact
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {tab === 'emote' && (
            <>
              <p className="text-sm text-fg-3">
                Емоциите се използват в мачовете срещу съперници — всички отключени са винаги под ръка.
              </p>
              <Grid>
                {EMOTES.map((e) => (
                  <Item key={e.id} name="" req={e.req} unlocked={unlocked(e.req)}>
                    <Emoji e={e.emoji} size="3rem" />
                  </Item>
                ))}
              </Grid>
            </>
          )}
          {tab === 'powerup' && (
            <>
              {/* The one place to read them at leisure: the match itself has no time for it. */}
              <p className="mb-4 max-w-2xl text-sm text-fg-2">
                Всеки играе с всичките четири от първия си мач, освен във въпросите на деня и в линковете с
                предизвикателство, където всички играят едно и също. Всеки коз е по веднъж на мач и по един на въпрос.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {POWERUPS.map((p) => (
                  <Card key={p.id} className="p-5">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="grid size-12 place-items-center rounded-2xl bg-amber-400/15 text-2xl"
                      >
                        <Emoji e={p.icon} />
                      </span>
                      <div className="font-extrabold">{p.name}</div>
                      <KeyHint className="ml-auto">{POWERUP_KEYS[p.id]}</KeyHint>
                    </div>
                    <p className="mt-3 text-sm text-fg-2">{p.description}</p>
                  </Card>
                ))}
              </div>
            </>
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
  const [info, setInfo] = useState(false);
  return (
    // Lifts on hover, detected on a wrapper that stays put (so the lift can't flicker under a resting pointer). The
    // wrapper's column is the tile's: a long requirement line truncates instead of widening it past the screen.
    <div className="group/lift grid grid-cols-[minmax(0,1fr)]">
      <motion.button
        type="button"
        whileTap={clickable ? { scale: 0.96 } : undefined}
        // Locked: still a button, which says what it takes (a disabled one can't be reached or tapped).
        disabled={unlocked && !clickable}
        onClick={unlocked ? onEquip : () => setInfo(true)}
        aria-label={unlocked ? undefined : `${name || 'Емоция'}: заключено — ${requirementLabel(req)}`}
        title={unlocked ? name : `${name} — ${requirementLabel(req)}`}
        className={clsx(
          'focus-ring glass relative flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center transition-[translate,background-color]',
          equipped && 'border-violet-400/70 bg-violet-500/15 shadow-[0_0_24px_-8px_rgb(139_92_246/0.9)]',
          clickable &&
            'hover:bg-tint/10 group-hover/lift:-translate-y-[3px] motion-reduce:group-hover/lift:translate-y-0',
          saving && 'animate-pulse',
        )}
      >
        <span className={clsx(!unlocked && 'opacity-30 grayscale')}>{children}</span>
        {name && <span className="w-full truncate text-xs font-semibold">{name}</span>}
        {!unlocked && (
          <span className="flex max-w-full items-center gap-1 text-xs leading-tight text-fg-3">
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
      {!unlocked && (
        <LockedInfo name={name || 'Емоция'} req={req} open={info} onClose={() => setInfo(false)}>
          {children}
        </LockedInfo>
      )}
    </div>
  );
}

/** What a locked item takes, and how far along you are. */
function LockedInfo({
  name,
  req,
  open,
  onClose,
  children,
}: {
  name: string;
  req: Requirement;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={name}>
      <div className="flex items-center gap-4">
        {children && (
          <span aria-hidden className="shrink-0 opacity-60 grayscale">
            {children}
          </span>
        )}
        <div>
          <p className="text-sm text-fg-3">
            <Lock aria-hidden className="mb-0.5 inline size-3.5" /> Отключва се с
          </p>
          <p className="font-semibold">{requirementLabel(req)}</p>
        </div>
      </div>
      {open && 'level' in req && <LevelProgress level={req.level} />}
      {open && 'achievement' in req && <AchievementSteps id={req.achievement} />}
      {open && 'mastery' in req && (
        <p className="mt-4 text-sm text-fg-2">
          Степента се мери спрямо останалите играчи, след поне 30 отговора в категорията.
        </p>
      )}
    </Modal>
  );
}

function LevelProgress({ level }: { level: number }) {
  const xp = useStore((s) => s.me!.xp);
  const need = xpToReach(level);
  return (
    <div className="mt-5">
      <ProgressBar value={xp / need} />
      <p className="mt-1.5 text-sm text-fg-3 tabular-nums">
        {fmt(xp)} / {fmt(need)} XP · още {fmt(Math.max(0, need - xp))} XP
      </p>
    </div>
  );
}

function AchievementSteps({ id }: { id: string }) {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  const { data } = useLoad(() => api.achievements());
  const progress = data?.achievements.find((a) => a.id === id)?.progress ?? null;
  return (
    <div className="mt-5 space-y-2">
      {def && <p className="text-sm text-fg-2">{def.description}</p>}
      {def?.goal !== undefined && progress !== null && (
        <>
          <ProgressBar value={progress / def.goal} />
          <p className="text-sm text-fg-3 tabular-nums">
            {fmt(progress)} / {fmt(def.goal)}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * A title to wear: picked with a tap once it's unlocked; until then, what it takes. `compact`: a mastery tier in its
 * category's row (`icon` and `label` say which; the button's name says it in full).
 */
function TitleButton({
  title: t,
  label,
  icon,
  open,
  equipped,
  onEquip,
  compact,
}: {
  title: TitleDef;
  label?: string;
  icon?: string;
  open: boolean;
  equipped: boolean;
  onEquip: () => void;
  compact?: boolean;
}) {
  const state = open ? (equipped ? 'Избрана' : 'Избери') : compact ? 'заключена' : requirementLabel(t.req);
  const [info, setInfo] = useState(false);
  const locked = !open && <LockedInfo name={t.name} req={t.req} open={info} onClose={() => setInfo(false)} />;
  if (compact)
    return (
      <>
        <button
          type="button"
          disabled={open && equipped}
          onClick={open ? onEquip : () => setInfo(true)}
          aria-label={`${t.name}: ${open ? state.toLowerCase() : requirementLabel(t.req)}`}
          className={clsx(
            'focus-ring flex min-w-0 flex-col items-center rounded-2xl border border-line bg-tint/[0.03] px-1.5 py-2 text-center transition-colors',
            open && !equipped && 'hover:bg-tint/10',
            equipped && 'border-violet-400/60 bg-violet-500/15',
          )}
        >
          <span aria-hidden className={clsx('text-lg leading-6', !open && 'opacity-50 grayscale')}>
            {equipped ? <Check className="mx-auto size-5 text-violet-300" /> : icon && <Emoji e={icon} />}
          </span>
          <span className="max-w-full truncate text-sm font-semibold">{label}</span>
          <span className="text-xs text-fg-3">{state}</span>
        </button>
        {locked}
      </>
    );
  return (
    <>
      <button
        type="button"
        disabled={open && equipped}
        onClick={open ? onEquip : () => setInfo(true)}
        className={clsx(
          'focus-ring glass flex items-center justify-between gap-3 rounded-2xl p-4 text-left transition-colors',
          open && !equipped && 'hover:bg-tint/10',
          equipped && 'border-violet-400/60 bg-violet-500/15',
        )}
      >
        <span>
          <span className="block font-semibold">{t.name}</span>
          <span className="text-xs text-fg-3">{state}</span>
        </span>
        {equipped ? <Check className="size-5 text-violet-300" /> : !open && <Lock className="size-4 text-fg-3" />}
      </button>
      {locked}
    </>
  );
}
