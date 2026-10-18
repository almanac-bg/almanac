import { BRAND, levelProgress } from '@quiz/shared';
import clsx from 'clsx';
import { ChartColumn, Gamepad2, LogOut, Settings, Shirt, Trophy, User, Users, Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import { isMuted, setMuted } from '../lib/sound';
import { setState, useStore } from '../lib/store';
import { Avatar, LevelBadge } from './Avatar';

const LINKS = [
  { to: '/', label: 'Играй', icon: Gamepad2, end: true, mobile: true },
  { to: '/friends', label: 'Приятели', icon: Users, mobile: true },
  { to: '/profile', label: 'Профил', icon: User, mobile: true },
  { to: '/achievements', label: 'Постижения', icon: Trophy, mobile: false },
  { to: '/locker', label: 'Колекция', icon: Shirt, mobile: true },
  { to: '/leaderboard', label: 'Класации', icon: ChartColumn, mobile: true },
];

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

export function NavBar() {
  const me = useStore((s) => s.me)!;
  const connected = useStore((s) => s.connected);
  const [muted, setMutedState] = useState(isMuted());
  const navigate = useNavigate();
  const progress = levelProgress(me.xp);

  async function logout() {
    await api.logout().catch(() => {});
    socket.disconnect();
    setState({ me: null, room: null, game: null, queue: null });
    navigate('/');
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="focus-ring rounded-lg text-xl">
            <Logo />
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {LINKS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) =>
                  clsx(
                    'focus-ring flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors',
                    isActive ? 'bg-white/10 text-fg' : 'text-fg-3 hover:text-fg-2',
                  )
                }
              >
                <Icon className="size-4" />
                <span className="hidden lg:inline">{label}</span>
                {to === '/friends' && <RequestBadge count={me.friendRequests} />}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {!connected && (
              <span className="inline-flex items-center gap-2 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">
                <span className="size-2 animate-pulse rounded-full bg-rose-400" />
                Свързване…
              </span>
            )}
            <button
              onClick={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
              aria-label={muted ? 'Включи звука' : 'Изключи звука'}
              className="focus-ring grid size-9 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg"
            >
              {muted ? <VolumeX className="size-4.5" /> : <Volume2 className="size-4.5" />}
            </button>
            <Link
              to="/profile"
              className="focus-ring flex items-center gap-2.5 rounded-2xl py-1 pr-3 pl-1 hover:bg-white/5"
            >
              <Avatar avatar={me.avatar} frame={me.frame} size={36} />
              <div className="hidden w-28 sm:block">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{me.username}</span>
                  <LevelBadge level={progress.level} />
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#22d3ee)]"
                    style={{ width: `${progress.pct * 100}%` }}
                  />
                </div>
              </div>
            </Link>
            <Link
              to="/settings"
              aria-label="Настройки"
              title="Настройки"
              className="focus-ring grid size-9 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg"
            >
              <Settings className="size-4.5" />
            </Link>
            <button
              onClick={logout}
              aria-label="Изход"
              title="Изход"
              className="focus-ring grid size-9 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg"
            >
              <LogOut className="size-4.5" />
            </button>
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
                  'relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold',
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
