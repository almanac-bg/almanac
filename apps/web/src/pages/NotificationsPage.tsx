import { api, setState, timeAgo } from '@quiz/client';
import type { AppNotification } from '@quiz/shared';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { LoadError } from '../components/LoadError';
import { Card, EmptyState, PageSpinner } from '../components/ui';
import { useLoad } from '../lib/load';
import { usePageTitle } from '../lib/title';

/**
 * What happened while you were away: a link of yours played, a question approved, a rematch someone wanted. Opening
 * the list marks it seen (the ones that were new keep their mark until you leave the page).
 */
export function NotificationsPage() {
  usePageTitle('Известия');
  const { data, error, retry } = useLoad(() => api.notifications());
  const items = data?.notifications ?? null;
  const unseen = !!items?.some((n) => !n.read);

  useEffect(() => {
    if (!unseen) return;
    api.readNotifications().then(
      () => setState((s) => ({ me: s.me && { ...s.me, unreadNotifications: 0 } })),
      () => {}, // still unseen: the count stays, and the next visit marks them
    );
  }, [unseen]);

  if (!items && error) return <LoadError title="Известията не се заредиха" error={error} onRetry={retry} />;
  if (!items) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="t-page">Известия</h1>
      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="🔔"
            title="Нищо ново"
            body="Тук ще видиш, когато някой изиграе твой линк, когато въпросът ти бъде одобрен или някой поиска реванш."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id}>
                <Item note={n} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Item({ note }: { note: AppNotification }) {
  const body = (
    <>
      <span aria-hidden className="text-2xl leading-none">
        {note.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block text-sm', note.read ? 'text-fg-2' : 'font-semibold text-fg')}>{note.text}</span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-fg-3">
          {timeAgo(note.createdAt)}
          {!note.read && (
            <span className="rounded-full bg-violet-500/20 px-2 py-px font-semibold text-violet-200">ново</span>
          )}
        </span>
      </span>
      {note.link && <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" />}
    </>
  );
  const row = 'flex items-center gap-3.5 px-5 py-4';
  return note.link ? (
    <Link to={note.link} className={clsx(row, 'focus-ring transition-colors hover:bg-white/[0.04]')}>
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}
