import { actions } from '@quiz/client';
import { emoteById } from '@quiz/shared';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { m } from 'motion/react';
import { useId, useState } from 'react';
import { sfx } from '../../lib/sound';
import { Emoji } from '../Emoji';

/**
 * Wider screens: the whole bar, fixed along the bottom (below the answers). Phones: a button in the page under the
 * answers that opens them right there — floating over the screen, it sat on the last answers.
 */
export function EmoteBar({ emotes, offline }: { emotes: string[]; offline: boolean }) {
  const [cooldown, setCooldown] = useState(false);
  const [open, setOpen] = useState(false);
  const trayId = useId();
  function send(id: string) {
    if (cooldown || offline) return;
    actions.react(id);
    sfx.pop();
    setCooldown(true);
    setOpen(false);
    setTimeout(() => setCooldown(false), 800);
  }
  const buttons = emotes.map((id) => (
    <m.button
      key={id}
      type="button"
      whileTap={{ scale: 0.8 }}
      whileHover={{ scale: 1.2, y: -3 }}
      onClick={() => send(id)}
      disabled={offline}
      className={clsx(
        'focus-ring grid size-11 shrink-0 place-items-center rounded-xl text-2xl',
        (cooldown || offline) && 'opacity-50',
      )}
      aria-label={`Емоция: ${emoteById(id)?.name ?? ''}`}
    >
      <Emoji e={emoteById(id)?.emoji ?? ''} />
    </m.button>
  ));
  // Phones (and phones held sideways, where a bar along the bottom would sit on the jokers): a button that opens the
  // tray in the page. Wider screens: a bar along the bottom.
  return (
    <>
      <div className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center justify-end gap-2 sm:hidden flat:flex">
        {open && (
          <div
            id={trayId}
            className="flex flex-wrap justify-end gap-1 rounded-2xl border border-line bg-ink-2/80 p-1.5"
          >
            {buttons}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label="Емоции"
          aria-expanded={open}
          aria-controls={open ? trayId : undefined}
          className="focus-ring grid size-12 shrink-0 place-items-center rounded-full border border-line bg-ink-2/90 text-fg-2 hover:text-fg"
        >
          {open ? <X className="size-5" /> : <Emoji e="😀" size={24} />}
        </button>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 hidden pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] sm:block flat:hidden">
        <div className="mx-auto mb-3 flex w-fit max-w-[calc(100vw-1.5rem)] gap-1 overflow-x-auto rounded-2xl border border-line bg-ink-2/80 p-1.5 backdrop-blur-xl">
          {buttons}
        </div>
      </div>
    </>
  );
}
