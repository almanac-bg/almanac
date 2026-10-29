import { useStore } from '@quiz/client';
import { MailWarning, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../ui';

/**
 * Without a verified email a forgotten password means a lost account — nudge until one is added. Not before the first
 * match, though (every finished match earns XP): a brand-new player's first screen is for playing.
 */
export function EmailNudge() {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('quiz:email-nudge') === '1';
    } catch {
      return false;
    }
  });
  // A guest adds an email while saving the account (the profile card asks for that instead).
  // After a few matches: on the first days it only stood between a newcomer and the game.
  if (me.isGuest || me.email || me.pendingEmail || dismissed || me.stats.games < 5) return null;
  return (
    // Phones: icon, text and close on the first row, the button under the text. Wider: all in one row.
    <div className="glass grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl border-violet-400/30 py-2 pr-1.5 pl-4 sm:flex sm:pl-5">
      <MailWarning aria-hidden className="size-5 shrink-0 text-violet-300" />
      <span className="min-w-0 py-1 text-sm sm:flex-1">
        Добави имейл, за да можеш да възстановиш паролата си, ако я забравиш.
      </span>
      <Button
        variant="secondary"
        className="col-start-2 row-start-2 mb-1.5 justify-self-start sm:mb-0"
        onClick={() => navigate('/settings')}
      >
        Добави имейл
      </Button>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem('quiz:email-nudge', '1');
          } catch {
            /* storage unavailable */
          }
        }}
        aria-label="Скрий"
        title="Скрий"
        className="focus-ring col-start-3 row-start-1 grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-tint/5 hover:text-fg"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
