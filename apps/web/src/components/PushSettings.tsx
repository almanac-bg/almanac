import { api, errorMessage, setState, toast, useStore } from '@quiz/client';
import { PUSH, PUSH_KINDS, type PushKind, type PushPrefs } from '@quiz/shared';
import clsx from 'clsx';
import { BellRing, Share } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button, Card, SwitchTrack } from './ui';

/** The key as the browser wants it (the server gives it base64url). */
function keyBytes(base64url: string) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const apple = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** The worker that shows pushes: the one the app registered (production), or registered here (development). */
async function worker() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
}

const clock = (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
const DAILY_TIMES = Array.from(
  { length: (PUSH.dailyTo - PUSH.dailyFrom) / PUSH.dailyStep + 1 },
  (_, i) => PUSH.dailyFrom + i * PUSH.dailyStep,
);

/**
 * Settings → push notifications on this device: on or off here (each device asks its own permission), and what to send
 * (the player's choice, for all their devices). Hidden where the site has no push set up.
 */
export function PushSettings() {
  const me = useStore((s) => s.me)!;
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [here, setHere] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const timeId = useId();

  useEffect(() => {
    api
      .pushKey()
      .then((r) => setKey(r.key))
      .catch(() => setKey(null));
    if (!supported()) return;
    setPermission(Notification.permission);
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setHere(sub ?? null))
      .catch(() => {});
  }, []);

  if (!key) return null;

  async function enable() {
    setBusy(true);
    try {
      const asked = await Notification.requestPermission();
      setPermission(asked);
      if (asked !== 'granted') return;
      const reg = await worker();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key!) });
      const { user } = await api.pushSubscribe(sub.toJSON());
      setState({ me: user });
      setHere(sub);
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err, 'Известията не се включиха на това устройство.') });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!here) return;
    setBusy(true);
    try {
      await api.pushUnsubscribe(here.endpoint);
      await here.unsubscribe();
      setHere(null);
      toast({ kind: 'info', title: 'Известията са изключени на това устройство' });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function save(prefs: PushPrefs) {
    try {
      const { user } = await api.setPushPrefs(prefs);
      setState({ me: user });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    }
  }

  const prefs = me.push;
  const toggleKind = (kind: PushKind) =>
    prefs && void save({ ...prefs, kinds: { ...prefs.kinds, [kind]: !prefs.kinds[kind] } });

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <BellRing className={clsx('size-5', here ? 'text-violet-300' : 'text-fg-3')} />
        <h2 className="t-card">Известия на устройството</h2>
      </div>
      <p className="mt-2 text-sm text-fg-2">
        Кратко известие, когато е важно: напомняне за въпросите на деня, серията в опасност, твой ред в дуел. Най-много
        {` ${PUSH.perDay}`} на ден и нищо между {PUSH.quietFrom}:00 и {PUSH.quietUntil}:00.
      </p>

      {!supported() ? (
        apple() && !installed() ? (
          <p className="mt-4 flex items-start gap-2 rounded-2xl border border-line bg-sunk/20 px-4 py-3 text-sm text-fg-2">
            <Share aria-hidden className="mt-0.5 size-4 shrink-0 text-violet-300" />
            <span>
              На iPhone и iPad известията идват в инсталираната игра: в Safari натисни „Сподели“ → „Добави към началния
              екран“, отвори АЛМАНАХ оттам и ги включи тук.
            </span>
          </p>
        ) : (
          <p className="mt-4 text-sm text-fg-3">Този браузър не поддържа известия.</p>
        )
      ) : permission === 'denied' ? (
        <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-fg-2">
          Известията са забранени за сайта в настройките на браузъра. Разреши ги там (иконата до адреса или настройките
          на сайта) и се върни тук.
        </p>
      ) : here ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-emerald-300">✓ Включени на това устройство</span>
          <Button size="sm" variant="ghost" onClick={disable} loading={busy}>
            Изключи тук
          </Button>
        </div>
      ) : (
        <Button className="mt-4" onClick={enable} loading={busy}>
          <BellRing className="size-4" /> Включи на това устройство
        </Button>
      )}

      {prefs && (
        <div className="mt-6 space-y-4 border-t border-line pt-5">
          <p className="text-xs text-fg-3">Какво да идва — за всичките ти устройства с включени известия:</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor={timeId} className="text-sm font-semibold">
              Напомняне за въпросите на деня
              <span className="block text-xs font-normal text-fg-3">Само ако дотогава въпросите още те чакат</span>
            </label>
            <select
              id={timeId}
              value={prefs.daily ?? ''}
              onChange={(e) => void save({ ...prefs, daily: e.target.value === '' ? null : Number(e.target.value) })}
              className="field h-10 rounded-xl pr-10 pl-3 text-sm"
            >
              <option value="" className="bg-ink-2">
                Без
              </option>
              {DAILY_TIMES.map((m) => (
                <option key={m} value={m} className="bg-ink-2">
                  {clock(m)}
                </option>
              ))}
            </select>
          </div>
          {PUSH_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="switch"
              aria-checked={prefs.kinds[k.id]}
              onClick={() => toggleKind(k.id)}
              className="focus-ring flex w-full items-center justify-between gap-4 rounded-xl text-left"
            >
              <span>
                <span className="block text-sm font-semibold">{k.label}</span>
                <span className="block text-xs text-fg-3">{k.hint}</span>
              </span>
              <SwitchTrack on={prefs.kinds[k.id]} />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
