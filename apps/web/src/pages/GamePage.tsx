import { actions, type LiveGame, useStore } from '@quiz/client';
import { MODES, type PowerupId } from '@quiz/shared';
import clsx from 'clsx';
import { DoorOpen } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { Emoji } from '../components/Emoji';
import { MatchAnnouncer } from '../components/game/Announcer';
import { leaveMatchScreen, useBackGuard } from '../components/game/backGuard';
import { EmoteBar } from '../components/game/EmoteBar';
import { Intro } from '../components/game/Intro';
import { EliminationBanner, Feed, othersStillIn, StreakBurst } from '../components/game/Moments';
import { POWERUP_KEYS } from '../components/game/Powerups';
import { PresenterScreen } from '../components/game/PresenterScreen';
import { QuestionView } from '../components/game/QuestionView';
import { RoundPick } from '../components/game/RoundPick';
import { MobileStrip, Scoreboard } from '../components/game/Scoreboard';
import { TopBar } from '../components/game/TopBar';
import { Button, Modal } from '../components/ui';
import { useMediaQuery } from '../lib/media';
import { usePageTitle } from '../lib/title';
import { Results } from './Results';

export function GamePage() {
  const game = useStore((s) => s.game);
  usePageTitle(game ? MODES[game.start.mode].name : null);
  if (!game) return <Navigate to="/" replace />;
  // A room's host running it on a big screen: the whole match there, to its end.
  if (game.start.presenter) return <PresenterScreen game={game} />;
  if (game.phase === 'ended' && game.end) return <Results game={game} />;
  return <Arena game={game} />;
}

const ANSWER_KEYS = ['1', '2', '3', '4'];
/** By the key's place (as the top row's digits, for layouts whose digits need Shift). */
const ANSWER_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const POWERUP_BY_CODE = new Map<string, PowerupId>(
  Object.entries(POWERUP_KEYS).map(([id, key]) => [`Key${key}`, id as PowerupId]),
);

/**
 * 1–4 answer (and 1–3 pick a round's category), Q–E play a коз — but not behind a dialog, and not while typing
 * somewhere. A key presses its button, so it does exactly what a click would, and nothing when the button can't be
 * pressed. A number question takes its digits itself (NumberAnswer).
 */
function useMatchKeys(paused: boolean) {
  const pausedNow = useRef(paused);
  useEffect(() => {
    pausedNow.current = paused;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const byKey = ANSWER_KEYS.indexOf(e.key);
      const choice = byKey >= 0 ? byKey : ANSWER_CODES.indexOf(e.code);
      const powerup = POWERUP_BY_CODE.get(e.code);
      if ((choice < 0 && !powerup) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (pausedNow.current || document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
      // Like a tap, on what's on screen: not on a question still on its way in behind the last one's reveal.
      if (choice >= 0)
        document.querySelector<HTMLButtonElement>(`[data-answer="${choice}"]:not([aria-disabled])`)?.click();
      else document.querySelector<HTMLButtonElement>(`[data-powerup="${powerup}"]:not(:disabled)`)?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Arena({ game }: { game: LiveGame }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const [leaving, setLeaving] = useState(false);
  const offline = !useStore((s) => s.connected);
  const single = game.start.players.length === 1;
  const meEliminated = game.eliminated.includes(game.start.youId);
  // In a private room leaving the match leaves the room too, so that's no place to suggest it.
  const freeToGo = meEliminated && !game.start.roomCode;
  // Knocked out with only bots left: the server plays their final out at once, so the bar says the result is coming
  // rather than inviting you to stay and watch.
  const watching = meEliminated && othersStillIn(game) > 0;
  const leave = () => leaveMatchScreen(actions.leaveGame);

  // The back button asks first, like ✕ does; pressed again it dismisses the question, as back does on Android.
  useBackGuard(() => setLeaving((open) => !open));
  useMatchKeys(leaving);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar game={game} onLeave={() => setLeaving(true)} />
      {!single && <MobileStrip game={game} />}

      <div
        className={clsx(
          // Wider screens: the match sits a little lower than the very top, rather than pinned under the bar.
          'mx-auto grid w-full max-w-6xl flex-1 content-start gap-6 px-4 pt-4 pb-28 short:pt-2 sm:px-6 md:pt-[6vh] flat:pt-2',
          !single && 'lg:grid-cols-[minmax(0,1fr)_320px]',
          // Room for the spectator bar under the last answer.
          meEliminated && 'max-sm:pb-40',
        )}
      >
        <div className="relative min-w-0">
          <AnimatePresence mode="wait">
            {game.phase === 'countdown' ? (
              <Intro key="intro" game={game} />
            ) : game.phase === 'pick' && game.pick ? (
              <RoundPick key={`pick${game.pick.round}`} game={game} />
            ) : game.question ? (
              <QuestionView key={`q${game.question.index}`} game={game} offline={offline} />
            ) : (
              <m.div
                key="wait"
                className="grid place-items-center py-32 text-fg-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                Следващият въпрос идва…
              </m.div>
            )}
          </AnimatePresence>
          {!single && <EmoteBar emotes={game.start.emotes} offline={offline} />}
          <Feed game={game} />
        </div>
        {/* Wide screens only: on a phone the strip above says it, and a hidden board would still redraw every tick. */}
        {!single && wide && (
          <aside>
            <Scoreboard game={game} />
          </aside>
        )}
      </div>

      <StreakBurst game={game} />
      <EliminationBanner game={game} />
      <MatchAnnouncer game={game} />
      {meEliminated && game.phase !== 'countdown' && (
        // Phones: at the bottom edge (the emotes are in the page there). Wider: above the emote bar. The button goes
        // beside the first line and the second line runs under both, so a narrow phone loses as little of the screen.
        <div
          className={clsx(
            'fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto grid w-fit max-w-[calc(100vw-1.5rem)] items-center gap-x-3 gap-y-0.5 rounded-2xl border border-rose-400/30 bg-ink-2/90 py-2 pl-4 text-sm backdrop-blur sm:bottom-20',
            freeToGo && watching ? 'grid-cols-[minmax(0,1fr)_auto] pr-2' : 'pr-4',
          )}
        >
          {watching ? (
            <p className="text-balance text-rose-200">
              <Emoji e="💀" /> Отпадна — гледаш като зрител
            </p>
          ) : (
            <p className="text-balance text-rose-200">
              <Emoji e="💀" /> Отпадна. Останаха само ботове — резултатът идва след миг.
            </p>
          )}
          {freeToGo && watching && (
            <>
              <p className="col-span-2 text-xs text-fg-2">
                Можеш да излезеш — мястото ти се запазва, а наградите идват в края на мача.
              </p>
              {/* Knocked out, leaving is no forfeit (the place stands, the rewards come at the end): no "are you sure". */}
              <Button size="sm" variant="secondary" className="col-start-2 row-start-1" onClick={leave}>
                <DoorOpen className="size-4" /> Излез
              </Button>
            </>
          )}
        </div>
      )}

      <Modal open={leaving} onClose={() => setLeaving(false)} title="Да напуснеш ли мача?">
        <p className="text-fg-2">
          {meEliminated
            ? game.start.roomCode
              ? 'Мястото, на което отпадна, се запазва, но излизаш и от стаята.'
              : 'Мястото, на което отпадна, се запазва — наградите идват, когато мачът свърши.'
            : game.start.mode === 'daily'
              ? 'Днешният опит ще се зачете с точките досега — нов опит има чак утре.'
              : game.start.ranked
                ? 'Оставаш на последно място и губиш рейтинг.'
                : 'Прогресът от този мач няма да се зачете.'}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setLeaving(false)}>
            Остани
          </Button>
          <Button variant={meEliminated ? 'primary' : 'danger'} onClick={leave}>
            Напусни
          </Button>
        </div>
      </Modal>
    </div>
  );
}
