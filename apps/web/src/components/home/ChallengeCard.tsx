import { actions, api, fmt, plural, timeAgo, toast, useNow, useStore } from '@quiz/client';
import { MODES, type MyChallenge } from '@quiz/shared';
import clsx from 'clsx';
import { ChevronRight, Link2, Lock, Share2, Swords } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useLoad } from '../../lib/load';
import { shareText } from '../../lib/share';
import { ClaimAccountModal } from '../ClaimAccount';
import { LoadError } from '../LoadError';
import { Button, Card } from '../ui';
import { challengeShareText } from './challengeLink';

/** How many of your own links the card lists (newest first). */
const LISTED = 3;

/**
 * "Предизвикай приятел": a link with ten fixed questions. Making one starts it at once (the app opens the match);
 * your recent links sit beside it with who leads. Guests see what it is and how to unlock it.
 */
export function ChallengeCard({ className }: { className?: string }) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  // Guests have no links of their own to list.
  const mine = useLoad(() => (guest ? Promise.resolve(null) : api.myChallenges()), guest ? 'guest' : 'player');
  const now = useNow(60_000);
  const recent = mine.data?.challenges.slice(0, LISTED) ?? [];
  // The list (or why it's missing) goes beside the button when the card is wide; nothing made yet → no empty column.
  const aside = recent.length > 0 || (!!mine.error && !mine.data);

  async function create() {
    setBusy(true);
    const res = await actions.startChallenge();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }

  return (
    // Sized by its own width: beside another card it stacks, across the whole row the list moves to the side.
    <Card className={clsx('@container relative overflow-hidden p-5 sm:p-7', className)}>
      <div aria-hidden className="absolute -bottom-20 -left-12 size-56 rounded-full glow text-indigo-500/15" />
      <div
        className={clsx(
          'relative grid grid-cols-[minmax(0,1fr)] gap-5',
          aside && '@xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @xl:gap-7',
        )}
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2 text-indigo-300">
            <Link2 aria-hidden className="size-5" />
            <span className="t-eyebrow">С линк</span>
          </div>
          <h2 className="mt-2 t-card">Предизвикай приятел</h2>
          <p className="mt-1 max-w-md text-sm text-fg-3">
            {MODES.challenge.questions} въпроса, без козове. Изиграй ги и прати линка: всеки, който го отвори, играе
            същите въпроси веднъж. Линкът важи 7 дни.{guest && ' Предизвикателства създават играчите с профил.'}
          </p>
          <div className="mt-auto pt-5">
            {guest ? (
              // Said once, quietly (the lobby has one "save your progress" box, on the profile card).
              <>
                <Button variant="secondary" className="w-full @sm:w-auto" onClick={() => setClaiming(true)}>
                  <Lock aria-hidden className="size-4" /> Създай предизвикателство
                </Button>
                <ClaimAccountModal
                  open={claiming}
                  onClose={() => setClaiming(false)}
                  reason="Предизвикателства по линк създават играчите с профил. Избери име и парола — нивото, серията и всичко изиграно досега остават твои."
                />
              </>
            ) : (
              // The label is long: on the narrowest phones the icon and some padding make way for it.
              <Button variant="secondary" onClick={create} loading={busy} className="w-full @max-2xs:px-3 @sm:w-auto">
                <Swords className="size-4 @max-2xs:hidden" /> Създай предизвикателство
              </Button>
            )}
          </div>
        </div>
        {mine.error && !mine.data ? (
          <LoadError compact title="Предизвикателствата ти не се заредиха" error={mine.error} onRetry={mine.retry} />
        ) : recent.length > 0 ? (
          <section aria-labelledby="my-challenges" className="min-w-0">
            <h3 id="my-challenges" className="mb-2.5 t-eyebrow text-fg-3">
              Твоите предизвикателства
            </h3>
            <ul className="space-y-2">
              {recent.map((c) => (
                <ChallengeRow key={c.id} challenge={c} now={now} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Card>
  );
}

function ChallengeRow({ challenge: c, now }: { challenge: MyChallenge; now: number }) {
  const me = useStore((s) => s.me!);
  const expired = c.expiresAt <= now;
  const mine = c.leader?.username === me.username;
  const lead = !c.leader
    ? 'Още няма резултати'
    : mine
      ? c.players > 1
        ? `Водиш с ${fmt(c.leader.score)} т.`
        : `${fmt(c.leader.score)} т. · чака съперници`
      : `${c.leader.username} води с ${fmt(c.leader.score)} т.`;
  const made = new Date(c.createdAt).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });

  return (
    <li
      className={clsx(
        'flex items-center gap-1 rounded-2xl border border-line bg-sunk/20 py-0.5 pr-1 pl-3.5',
        expired && 'opacity-60',
      )}
    >
      <Link to={`/c/${c.id}`} className="focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl py-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{lead}</span>
          <span className="block truncate text-xs text-fg-3">
            {plural(c.players, 'играч', 'играчи')} · {expired ? 'изтекло' : `изтича ${timeAgo(c.expiresAt)}`}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" />
      </Link>
      {!expired && (
        <button
          type="button"
          onClick={() => shareText(challengeShareText(c.id, c.myScore), 'Линкът е копиран')}
          aria-label={`Сподели предизвикателството от ${made}`}
          title="Сподели линка"
          className="focus-ring grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-tint/5 hover:text-fg"
        >
          <Share2 className="size-4" />
        </button>
      )}
    </li>
  );
}
