import { BRAND, levelProgress } from '@quiz/shared';
import clsx from 'clsx';
import { ChartColumn, Gamepad2, Settings, Shirt, Trophy, User, Users, Volume2, VolumeX } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { useStore } from '@quiz/client';
import { useMuted } from '../lib/sound';
import { Avatar, LevelBadge } from './Avatar';

// The header doesn't list "Профил": the avatar and name next to it already lead there (and it's what makes the row fit).
const LINKS = [
  { to: '/', label: 'Играй', icon: Gamepad2, end: true, mobile: true, header: true },
  { to: '/friends', label: 'Приятели', icon: Users, mobile: true, header: true },
  { to: '/profile', label: 'Профил', icon: User, mobile: true, header: false },
  { to: '/achievements', label: 'Постижения', icon: Trophy, mobile: false, header: true },
  { to: '/locker', label: 'Колекция', icon: Shirt, mobile: true, header: true },
  { to: '/leaderboard', label: 'Класации', icon: ChartColumn, mobile: true, header: true },
];

/**
 * Bottom offset for a page's sticky action bar: just above the phone tab bar (h-16 plus its 1px border and the
 * home-indicator inset). From md up there's no tab bar.
 */
export const ABOVE_TAB_BAR = 'bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] md:bottom-0';

function RequestBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="grid min-w-4.5 place-items-center rounded-full bg-fuchsia-500 px-1 text-[10px] leading-4.5 font-bold text-white">
      {count}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('font-display font-black tracking-tight', className)}>
      <span className="text-gradient">{BRAND.name}</span>
      <span className="text-fuchsia-400">⚡</span>
    </span>
  );
}

const ICON_BUTTON = 'focus-ring grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg';

export function NavBar() {
  const me = useStore((s) => s.me)!;
  const connected = useStore((s) => s.connected);
  const [muted, setMuted] = useMuted();
  const progress = levelProgress(me.xp);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <Link to="/" className="focus-ring flex h-11 shrink-0 items-center rounded-lg text-lg sm:text-xl">
            <Logo />
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {LINKS.filter((l) => l.header).map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) =>
                  clsx(
                    'focus-ring flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors',
                    isActive ? 'bg-white/10 text-fg' : 'text-fg-3 hover:text-fg-2',
                  )
                }
              >
                <Icon className="size-4" />
                <span className="hidden xl:inline">{label}</span>
                {to === '/friends' && <RequestBadge count={me.friendRequests} />}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-0.5 sm:gap-2">
            {/* A lost connection shows on your avatar (a pulsing dot, plus the words under your name where there's room):
                a pill of its own would push the header off-screen on phones and past its edge on laptops. */}
            {!connected && (
              <span role="status" className="sr-only">
                Няма връзка — свързване…
              </span>
            )}
            <button
              onClick={() => setMuted(!muted)}
              aria-label={muted ? 'Включи звука' : 'Изключи звука'}
              title={muted ? 'Включи звука' : 'Изключи звука'}
              className={ICON_BUTTON}
            >
              {muted ? <VolumeX className="size-4.5" /> : <Volume2 className="size-4.5" />}
            </button>
            <NavLink
              to="/profile"
              end
              className={({ isActive }) =>
                clsx('focus-ring relative flex shrink-0 items-center gap-2.5 rounded-2xl p-1 sm:pr-3', isActive ? 'bg-white/10' : 'hover:bg-white/5')
              }
            >
              <span className="sr-only">Профил</span>
              <Avatar avatar={me.avatar} frame={me.frame} size={36} />
              {!connected && (
                <span
                  aria-hidden
                  className="absolute top-0.5 left-7.5 size-3 animate-pulse rounded-full border-2 border-ink bg-rose-400 shadow-[0_0_10px_rgb(251_113_133/0.8)]"
                />
              )}
              <div className="hidden w-28 sm:block">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{me.username}</span>
                  <LevelBadge level={progress.level} />
                </div>
                {connected ? (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#22d3ee)]"
                      style={{ width: `${progress.pct * 100}%` }}
                    />
                  </div>
                ) : (
                  <div aria-hidden className="text-[11px] leading-4 font-semibold text-rose-300">
                    Свързване…
                  </div>
                )}
              </div>
            </NavLink>
            <Link to="/settings" aria-label="Настройки" title="Настройки" className={ICON_BUTTON}>
              <Settings className="size-4.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-5">
          {LINKS.filter((l) => l.mobile).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'relative flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-semibold',
                  isActive ? 'text-fg' : 'text-fg-3',
                )
              }
            >
              <Icon className="size-5" />
              {label}
              {to === '/friends' && (
                <span className="absolute top-1.5 left-1/2 ml-1.5">
                  <RequestBadge count={me.friendRequests} />
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
