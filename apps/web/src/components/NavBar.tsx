import { useStore } from '@quiz/client';
import { BRAND, levelProgress } from '@quiz/shared';
import clsx from 'clsx';
import {
  Bell,
  BookOpen,
  ChartColumn,
  Gamepad2,
  Save,
  Settings,
  Shirt,
  User,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink } from 'react-router';
import { useMuted } from '../lib/sound';
import { Avatar, LevelBadge } from './Avatar';
import { ClaimAccountModal } from './ClaimAccount';

// Five a row has room for. The header doesn't list "Профил": the avatar and name next to it already lead there. On
// phones the profile has a tab and „Колекция“ doesn't. „Постижения“ opens from the profile everywhere.
const LINKS = [
  { to: '/', label: 'Играй', icon: Gamepad2, end: true, mobile: true, header: true },
  { to: '/almanac', label: 'Алманах', icon: BookOpen, mobile: true, header: true },
  { to: '/friends', label: 'Приятели', icon: Users, mobile: true, header: true },
  { to: '/profile', label: 'Профил', icon: User, mobile: true, header: false },
  { to: '/locker', label: 'Колекция', icon: Shirt, mobile: false, header: true },
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
    <span className="grid min-w-4.5 place-items-center rounded-full bg-fuchsia-600 px-1 text-[11px] leading-4.5 font-bold text-white">
      {count}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('font-display font-black tracking-tight', className)}>
      {/* One sweep when it appears, then still (see .text-gradient). */}
      <span className="text-gradient animate-shimmer-once">{BRAND.name}</span>
      <span aria-hidden className="text-fuchsia-400">
        ⚡
      </span>
    </span>
  );
}

const ICON_BUTTON =
  'focus-ring grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg';

function OfflineDot() {
  return (
    <span
      aria-hidden
      className="absolute top-0.5 left-7.5 size-3 animate-pulse rounded-full border-2 border-ink bg-rose-400 shadow-[0_0_10px_rgb(251_113_133/0.8)]"
    />
  );
}

/**
 * Playing as a guest: a standing reminder that opens "Запази прогреса". On phones it takes the avatar's place (the tab
 * bar already leads to the profile), so the header still fits a 320px screen.
 */
function GuestButton({ connected }: { connected: boolean }) {
  const me = useStore((s) => s.me)!;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Гост — запази прогреса"
        title="Играеш като гост — запази прогреса си"
        className="focus-ring relative flex h-11 shrink-0 items-center gap-2 rounded-2xl p-1 hover:bg-white/5 sm:border sm:border-amber-300/30 sm:bg-amber-400/10 sm:px-3 sm:text-sm sm:font-semibold sm:text-amber-100 sm:hover:bg-amber-400/15"
      >
        <span className="relative sm:hidden">
          <Avatar avatar={me.avatar} frame={me.frame} size={36} />
          <span
            aria-hidden
            className="absolute inset-x-0 -bottom-1 mx-auto w-fit rounded-md bg-amber-300 px-1 text-[10px] leading-3.5 font-extrabold tracking-wide text-amber-950 uppercase"
          >
            Гост
          </span>
          {!connected && <OfflineDot />}
        </span>
        <Save aria-hidden className="size-4 max-sm:hidden" />
        {/* As much of the label as the row has room for: the nav icons (md) and their labels (xl) take the rest. */}
        <span aria-hidden className="max-sm:hidden">
          Гост<span className="md:max-lg:hidden"> · Запази</span>
          <span className="hidden lg:max-xl:inline"> прогреса</span>
        </span>
      </button>
      <ClaimAccountModal
        open={open}
        onClose={() => setOpen(false)}
        reason={
          <>
            Играеш като гост (<b className="text-fg [overflow-wrap:anywhere]">{me.username}</b>): профилът е само на
            това устройство. Избери име и парола — нивото, серията и всичко изиграно остават твои, на всяко устройство.
          </>
        }
      />
    </>
  );
}

/** The bell: what happened while you were away (a link played, a question approved), with how much is new. */
function NotificationsButton({ unread }: { unread: number }) {
  const label = unread ? `Известия (${unread} нови)` : 'Известия';
  return (
    <NavLink
      to="/notifications"
      aria-label={label}
      title={label}
      className={({ isActive }) => clsx(ICON_BUTTON, 'relative', isActive && 'bg-white/10 text-fg')}
    >
      <Bell className="size-4.5" />
      {unread > 0 && (
        <span aria-hidden className="absolute top-1 right-1">
          <RequestBadge count={unread} />
        </span>
      )}
    </NavLink>
  );
}

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

          <nav aria-label="Основна навигация" className="ml-4 hidden items-center gap-1 md:flex">
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
            {/* A lost connection also shows on your avatar (a pulsing dot, plus the words under your name where there's
                room); ConnectionBanner says it in words and to screen readers. */}
            {/* Phones have room for four buttons: with an account the bell takes the sound's place (the match screen and
                Settings have the switch). */}
            <button
              type="button"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? 'Включи звука' : 'Изключи звука'}
              title={muted ? 'Включи звука' : 'Изключи звука'}
              className={clsx(ICON_BUTTON, !me.isGuest && 'max-sm:hidden')}
            >
              {muted ? <VolumeX className="size-4.5" /> : <Volume2 className="size-4.5" />}
            </button>
            {!me.isGuest && <NotificationsButton unread={me.unreadNotifications} />}
            {me.isGuest && <GuestButton connected={connected} />}
            <NavLink
              to="/profile"
              end
              className={({ isActive }) =>
                clsx(
                  'focus-ring relative flex shrink-0 items-center gap-2.5 rounded-2xl p-1',
                  // A guest's generated name says nothing (the "Гост" button does), so only the avatar shows.
                  !me.isGuest && 'sm:pr-3 md:max-lg:pr-1',
                  // Phones reach the profile from the tab bar; for a guest the "Гост" button takes this spot.
                  me.isGuest && 'max-sm:hidden',
                  isActive ? 'bg-white/10' : 'hover:bg-white/5',
                )
              }
            >
              <span className="sr-only">Профил</span>
              <Avatar avatar={me.avatar} frame={me.frame} size={36} />
              {!connected && <OfflineDot />}
              {/* Tablets have the nav icons in the row too: the avatar alone, until there's room for the name. */}
              <div className={clsx('hidden w-28', !me.isGuest && 'sm:block md:max-lg:hidden')}>
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
      <nav
        aria-label="Раздели"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="grid grid-cols-5">
          {LINKS.filter((l) => l.mobile).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'relative flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold tracking-tight',
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
