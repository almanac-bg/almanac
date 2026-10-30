import { api, fmt, refreshMe, unlockPreview, useStore } from '@quiz/client';
import { RANK_TIERS, seasonTitle } from '@quiz/shared';
import { m } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { sfx } from '../lib/sound';
import { Emoji } from './Emoji';
import { accentText } from './game/answers';
import { Button, Modal } from './ui';

/** Shown once after a season ends: the best rank reached, its XP and the cosmetics it unlocked. */
export function SeasonRecap() {
  const rewards = useStore((s) => s.me?.seasonRewards ?? []);
  const inGame = useStore((s) => !!s.game);
  const [closing, setClosing] = useState(false);
  const headingId = useId();
  const reward = rewards.at(-1);
  const open = !!reward && !inGame && !closing;
  const tier = reward?.tier ? RANK_TIERS.find((t) => t.id === reward.tier)! : null;

  useEffect(() => {
    if (!open || !tier) return;
    sfx.levelUp();
    // Its library loads for the moment it's needed (once a season), not with every visitor's first download.
    void import('canvas-confetti').then(({ default: confetti }) =>
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.4 },
        colors: [tier.color, '#ffffff', '#a78bfa'],
        disableForReducedMotion: true,
      }),
    );
  }, [open, tier]);

  async function close() {
    setClosing(true);
    await api.seasonSeen().catch(() => {});
    await refreshMe();
    setClosing(false);
  }

  if (!reward) return null;
  return (
    <Modal open={open} onClose={close} labelledBy={headingId} className="max-w-md text-center">
      <p className="t-eyebrow text-fg-3">Сезонът приключи</p>
      <h2 id={headingId} className="mt-2 font-display text-2xl font-bold">
        {seasonTitle(reward.season)}
      </h2>
      {tier ? (
        <>
          <m.div
            initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.15 }}
            className="mx-auto mt-6 grid size-28 place-items-center rounded-full text-5xl"
            style={{
              background: `radial-gradient(circle, ${tier.color}55, transparent 70%)`,
              boxShadow: `0 0 60px -10px ${tier.color}`,
            }}
          >
            <Emoji e="🏅" />
          </m.div>
          <p className="mt-4 text-fg-2">
            Достигна ранг <b style={{ color: accentText(tier.color) }}>{tier.name}</b>
          </p>
          <p className="mt-1 font-display text-3xl font-black text-violet-300">+{fmt(reward.xp)} XP</p>
          {reward.unlocks.length > 0 && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {reward.unlocks.map((u) => {
                const { icon, name } = unlockPreview(u);
                return (
                  <span
                    key={`${u.kind}:${u.id}`}
                    className="inline-flex items-center gap-2 rounded-xl border border-line bg-tint/5 px-3 py-2 text-sm"
                  >
                    <span className="text-lg leading-none">{icon}</span>
                    {name}
                  </span>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className="mt-6 text-fg-2">
          Не изигра достатъчно класирани мачове, за да получиш награда. Новият сезон вече тече!
        </p>
      )}
      <Button className="mt-8 w-full" onClick={close} loading={closing}>
        Към новия сезон
      </Button>
    </Modal>
  );
}
