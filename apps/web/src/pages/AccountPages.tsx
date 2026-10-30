import { api, disconnectRealtime, errorMessage, refreshMe, setState, signedOut, toast, useStore } from '@quiz/client';
import { type MeUser, PASSWORD_MIN_LENGTH } from '@quiz/shared';
import clsx from 'clsx';
import {
  Check,
  CheckCircle2,
  Disc3,
  Download,
  Flame,
  Keyboard,
  KeyRound,
  LogOut,
  Mail,
  MailCheck,
  MailWarning,
  Moon,
  Save,
  ShieldAlert,
  Sun,
  Swords,
  Trash2,
  TriangleAlert,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BlockedSettings } from '../components/BlockedSettings';
import { ClaimAccountModal } from '../components/ClaimAccount';
import { EmailLinkPage } from '../components/EmailLinkPage';
import { PasswordField } from '../components/PasswordField';
import { PushSettings } from '../components/PushSettings';
import { Button, buttonClass, Card, Field, INPUT, Modal, Segmented, SwitchTrack } from '../components/ui';
import { forgetThisDevice } from '../lib/device';
import { setMatchKeys, useMatchKeysOn } from '../lib/matchKeys';
import { markReturning } from '../lib/returning';
import { sfx, useMuted } from '../lib/sound';
import { setTheme, useThemeChoice } from '../lib/theme';
import { usePageTitle } from '../lib/title';

/** A labelled password input with a show/hide toggle (the label names the input alone, not the toggle). */
/** Standalone screen used by the email links (works signed in or out). */

// ─── /reset-password?token=… ─────────────────────────────────────────────────
// The forms here say `noValidate`: the browser's own bubbles speak the device's language (often English); the checks
// and the server's answers are shown in the form, in Bulgarian.

export function ResetPasswordPage() {
  usePageTitle('Нова парола');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH)
      return setError(`Паролата трябва да е поне ${PASSWORD_MIN_LENGTH} символа.`);
    if (password !== confirm) return setError('Паролите не съвпадат.');
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.resetPassword(token, password);
      setState({ me: user, authChecked: true });
      toast({ kind: 'success', title: 'Паролата е сменена. Здравей отново!' });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <EmailLinkPage>
      <KeyRound className="size-8 text-violet-300" />
      <h1 className="mt-3 t-section">Нова парола</h1>
      {!token ? (
        <p className="mt-3 text-sm text-rose-300">Линкът е непълен. Отвори го отново от писмото.</p>
      ) : (
        <form noValidate onSubmit={submit} className="mt-5 space-y-4">
          <PasswordField
            label="Нова парола"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder={`поне ${PASSWORD_MIN_LENGTH} символа`}
          />
          <PasswordField label="Повтори паролата" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Запази и влез
          </Button>
          <p className="text-xs text-fg-3">Всички други устройства ще бъдат отписани.</p>
        </form>
      )}
    </EmailLinkPage>
  );
}

// ─── /verify-email?token=… ───────────────────────────────────────────────────

/**
 * The link from the verification mail. It waits for a press, as the unsubscribe page does: mail scanners open links
 * (some run the page's scripts too), and one that confirmed on opening would let anyone confirm a stranger's address.
 */
export function VerifyEmailPage() {
  usePageTitle('Потвърждение на имейла');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const signedIn = useStore((s) => !!s.me);
  const [state, setLocal] = useState<'ready' | 'working' | 'done' | { error: string }>(() =>
    token ? 'ready' : { error: 'Линкът е непълен. Отвори го отново от писмото.' },
  );

  function confirm() {
    setLocal('working');
    api
      .verifyEmail(token)
      .then(() => {
        setLocal('done');
        void refreshMe();
      })
      .catch((err) => setLocal({ error: errorMessage(err) }));
  }

  return (
    <EmailLinkPage>
      {state === 'ready' || state === 'working' ? (
        <div className="text-center">
          <MailCheck className="mx-auto size-12 text-violet-300" />
          <h1 className="mt-3 t-section">Потвърди имейла си</h1>
          <p className="mt-2 text-sm text-fg-2">
            С потвърден имейл можеш да възстановиш паролата си и да получаваш писмата, които включиш.
          </p>
          <Button size="lg" className="mt-6 w-full" loading={state === 'working'} onClick={confirm}>
            Потвърди имейла
          </Button>
        </div>
      ) : state === 'done' ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-400" />
          <h1 className="mt-3 t-section">Имейлът е потвърден</h1>
          <p className="mt-2 text-sm text-fg-2">Вече можеш да възстановиш паролата си, ако някога я забравиш.</p>
          <Link to="/" className={clsx('mt-6', buttonClass())}>
            {signedIn ? 'Към играта' : 'Към входа'}
          </Link>
        </div>
      ) : (
        <div className="text-center">
          <XCircle className="mx-auto size-12 text-rose-400" />
          <h1 className="mt-3 t-section">Имейлът не е потвърден</h1>
          <p className="mt-2 text-sm text-fg-2">{state.error}</p>
          <Link to={signedIn ? '/settings' : '/'} className={clsx('mt-6', buttonClass({ variant: 'secondary' }))}>
            {signedIn ? 'Към настройките' : 'Към входа'}
          </Link>
        </div>
      )}
    </EmailLinkPage>
  );
}

// ─── /settings ───────────────────────────────────────────────────────────────

export function SettingsPage() {
  usePageTitle('Настройки');
  const me = useStore((s) => s.me)!;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="t-page">Настройки</h1>
          <p className="mt-1 text-fg-2 [overflow-wrap:anywhere]">
            {me.isGuest ? 'Профил на гост' : 'Профил'} <b className="text-fg">{me.username}</b>
          </p>
        </div>
      </div>
      {/* A guest has no email or password yet: saving the account comes first, and brings both. */}
      {me.isGuest ? (
        <ClaimSettings />
      ) : (
        <>
          <EmailSettings />
          <PushSettings />
          <ReminderSettings />
          <BeatenMailSettings />
          <RecordSettings />
          <BlockedSettings />
        </>
      )}
      <ThemeSettings />
      <SoundSettings />
      <MatchKeySettings />
      {!me.isGuest && <PasswordSettings />}
      <DataSettings />
      {/* Last: leaving is the rarest thing done here, and the least to be hit by mistake. */}
      <div className="flex justify-center pt-2">
        <LogoutButton />
      </div>
    </div>
  );
}

/** Forget the session on this device: back to the sign-in page with nothing of the old account left in memory. */
function clearSession() {
  disconnectRealtime();
  signedOut();
}

const EMAIL_INPUT_ID = 'settings-email';

/** Takes you to the email field (after a dialog that leads there has closed and handed focus back). */
function focusEmailField(delay = 0) {
  setTimeout(() => {
    const input = document.getElementById(EMAIL_INPUT_ID);
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
  }, delay);
}

function LogoutButton() {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await forgetThisDevice({ server: true });
    await api.logout().catch(() => {});
    // Next time the sign-in page opens on "Вход" — unless this was a guest, who has nothing to sign in with.
    if (!me.isGuest) markReturning();
    clearSession();
    navigate('/', { replace: true });
  }

  function addEmail() {
    setOpen(false);
    focusEmailField(350);
  }

  if (me.isGuest) {
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <LogOut className="size-4" /> Изход
        </Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Изход от профила на гост">
          {/* No name or password to come back with: leaving is losing the account, so say it plainly. */}
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-rose-200">
              <TriangleAlert className="size-5 shrink-0" /> Профилът ще бъде изгубен
            </p>
            <p className="mt-2 text-fg-2">
              Играеш като гост, без име и парола — след изход няма как да влезеш отново в{' '}
              <b className="text-fg [overflow-wrap:anywhere]">{me.username}</b>. Нивото, серията и всичко изиграно се
              губят завинаги.
            </p>
          </div>
          <p className="mt-4 text-sm text-fg-2">Запази прогреса с име и парола — отнема 10 секунди.</p>
          {/* Saving leads; leaving anyway stays available but quiet. Phones stack them full width. */}
          <div className="mt-6 grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button
              onClick={() => {
                setOpen(false);
                setClaiming(true);
              }}
              className="sm:mr-auto"
            >
              <Save className="size-4" /> Запази прогреса
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отказ
            </Button>
            <Button
              variant="ghost"
              className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
              onClick={logout}
              loading={busy}
            >
              <LogOut className="size-4" /> Излез без запазване
            </Button>
          </div>
        </Modal>
        <ClaimAccountModal open={claiming} onClose={() => setClaiming(false)} />
      </>
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <LogOut className="size-4" /> Изход
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Изход от профила">
        {me.email ? (
          <p className="text-sm text-fg-2">Ще можеш да влезеш отново с потребителското име или имейла и паролата си.</p>
        ) : (
          // Without a verified email a forgotten password means the account is gone for good: say so before they leave.
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-amber-200">
              <MailWarning className="size-5 shrink-0" /> Профилът няма потвърден имейл
            </p>
            <p className="mt-2 text-fg-2">
              {me.pendingEmail ? (
                <>
                  Линкът за потвърждение до <b className="text-fg [overflow-wrap:anywhere]">{me.pendingEmail}</b> още не
                  е отворен.{' '}
                </>
              ) : null}
              Ако забравиш паролата, профилът не може да бъде възстановен. Запомни името{' '}
              <b className="text-fg [overflow-wrap:anywhere]">{me.username}</b> и паролата си — или първо добави имейл.
            </p>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {!me.email && !me.pendingEmail && (
            <Button variant="secondary" onClick={addEmail} className="mr-auto">
              <Mail className="size-4" /> Добави имейл
            </Button>
          )}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Отказ
          </Button>
          <Button variant="danger" onClick={logout} loading={busy}>
            <LogOut className="size-4" /> Излез
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** An on/off setting: a card with a title, what it does, and a 44px switch named by the title. */
function SwitchCard({
  icon,
  title,
  hint,
  on,
  onToggle,
  disabled,
  busy,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: ReactNode;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** More about the setting under the hint (e.g. why it can't be switched on yet). */
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <Card className="p-6">
      {/* The switch sits level with the title, not halfway down a long description. */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 [&>svg]:shrink-0">
            {icon}
            <h2 id={`${id}-label`} className="t-card">
              {title}
            </h2>
          </div>
          <p id={`${id}-hint`} className="mt-1 text-sm text-fg-3">
            {hint}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          aria-busy={busy || undefined}
          disabled={disabled || busy}
          onClick={onToggle}
          className={clsx(
            'focus-ring grid h-11 w-16 shrink-0 place-items-center rounded-2xl',
            disabled ? 'cursor-not-allowed opacity-45' : busy && 'cursor-progress',
          )}
        >
          <SwitchTrack on={on} />
        </button>
      </div>
      {children}
    </Card>
  );
}

/** The colour theme on this device (lib/theme). */
function ThemeSettings() {
  const choice = useThemeChoice();
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        {choice === 'light' ? (
          <Sun aria-hidden className="size-5 text-amber-300" />
        ) : (
          <Moon aria-hidden className="size-5 text-violet-300" />
        )}
        <h2 className="t-card">Тема</h2>
      </div>
      <p className="mt-1 text-sm text-fg-3">На това устройство. Големият екран на стая е винаги светъл.</p>
      <div className="mt-4">
        <Segmented
          value={choice}
          onChange={setTheme}
          options={[
            { value: 'dark', label: 'Тъмна' },
            { value: 'light', label: 'Светла' },
            // Short enough for the three to share one row on a phone („Като системата“ wrapped onto a row of its own).
            { value: 'system', label: 'Системна' },
          ]}
        />
      </div>
    </Card>
  );
}

function SoundSettings() {
  const [muted, setMuted] = useMuted();
  const on = !muted;
  return (
    <SwitchCard
      icon={on ? <Volume2 className="size-5 text-violet-300" /> : <VolumeX className="size-5 text-fg-3" />}
      title="Звук"
      hint="Ефекти в играта: часовникът, верните и грешните отговори, наградите."
      on={on}
      onToggle={() => {
        setMuted(on);
        if (!on) sfx.pop(); // a taste of what was just switched on
      }}
    />
  );
}

/**
 * Достъпност: the match's one-key shortcuts on this device (lib/matchKeys). On for most; off for someone who dictates,
 * whose words reach the page as keys (a stray „e“ was a bet of 500 points).
 */
function MatchKeySettings() {
  const on = useMatchKeysOn();
  return (
    <SwitchCard
      icon={<Keyboard className={clsx('size-5', on ? 'text-violet-300' : 'text-fg-3')} />}
      title="Клавиши в мача"
      hint="Достъпност: 1–4 за отговорите, Q, W и E за козовете, P за пауза в Соло, цифри за число. Изключи ги, ако диктуваш или управляваш с глас — тогава нищо не се натиска случайно. На това устройство."
      on={on}
      onToggle={() => setMatchKeys(!on)}
    />
  );
}

/**
 * Others playing against recordings of your matches (when nobody's there for their Дуел): on unless switched off here.
 * They see your name, avatar and level, as on the boards.
 */
function RecordSettings() {
  const me = useStore((s) => s.me)!;
  const [busy, setBusy] = useState(false);
  const on = me.shareRuns;

  async function toggle() {
    setBusy(true);
    try {
      const { user } = await api.setShareRuns(!on);
      setState({ me: user });
      toast(
        user.shareRuns
          ? { kind: 'success', icon: '📼', title: 'Записите на мачовете ти пак играят' }
          : { kind: 'info', title: 'Записите на мачовете ти вече не играят' },
      );
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SwitchCard
      icon={<Disc3 className={clsx('size-5', on ? 'text-violet-300' : 'text-fg-3')} />}
      title="Записите на мачовете ми"
      hint="Когато няма с кого да се играе Дуел, другите могат да играят срещу запис на твой мач — със същите отговори и време като в твоя мач. Виждат името, аватара и нивото ти, а на другия ден ти казваме как се е справил записът (с XP за победите му)."
      on={on}
      onToggle={toggle}
      busy={busy}
    />
  );
}

/** An optional email (the streak reminder; someone beating you on your link): consent asked, a confirmed email needed. */
function MailOptIn({
  field,
  icon,
  title,
  hint,
  confirmText,
  onToast,
  set,
}: {
  field: 'streakReminders' | 'beatenMails';
  icon: (on: boolean) => ReactNode;
  title: string;
  hint: string;
  confirmText: string;
  onToast: { title: string; body: string };
  set: (on: boolean) => Promise<{ user: MeUser }>;
}) {
  const me = useStore((s) => s.me)!;
  const [busy, setBusy] = useState(false);
  // Optional emails rest on consent, and under 14 that's a parent's: asked where it's given.
  const [confirming, setConfirming] = useState(false);
  const on = me[field];
  // Switching off always works; switching on needs somewhere to send the email.
  const blocked = !on && !me.email;

  async function toggle() {
    setConfirming(false);
    setBusy(true);
    try {
      const { user } = await set(!on);
      setState({ me: user });
      toast(
        user[field]
          ? { kind: 'success', title: onToast.title, body: onToast.body }
          : { kind: 'info', title: `${title}: изключено` },
      );
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SwitchCard
      icon={icon(on)}
      title={title}
      hint={
        <>
          {hint} Спираш го оттук или от линка във всяко писмо. Под 14 години — със съгласие на родител или настойник.
          {blocked && <span className="sr-only"> Нужен е потвърден имейл.</span>}
        </>
      }
      on={on}
      onToggle={() => (on ? toggle() : setConfirming(true))}
      disabled={blocked}
      busy={busy}
    >
      <Modal open={confirming} onClose={() => setConfirming(false)} title={title}>
        <p className="text-sm text-fg-2">{confirmText}</p>
        <p className="mt-3 text-sm text-fg">
          Потвърждаваш, че си над 14 години или имаш съгласие на родител или настойник.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Отказ
          </Button>
          <Button onClick={toggle}>Потвърждавам, включи</Button>
        </div>
      </Modal>
      {blocked && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-sunk/20 px-4 py-3 text-sm">
          <MailWarning aria-hidden className="size-5 shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1 basis-48 text-fg-2">
            {me.pendingEmail ? (
              <>
                Отвори линка, който изпратихме до <b className="text-fg [overflow-wrap:anywhere]">{me.pendingEmail}</b>,
                и после го включи.
              </>
            ) : (
              'Нужен е потвърден имейл — добави го по-горе.'
            )}
          </span>
          {!me.pendingEmail && (
            <Button size="sm" variant="secondary" onClick={() => focusEmailField()}>
              <Mail className="size-4" /> Добави имейл
            </Button>
          )}
        </div>
      )}
    </SwitchCard>
  );
}

function ReminderSettings() {
  return (
    <MailOptIn
      field="streakReminders"
      icon={(on) => <Flame className={clsx('size-5', on ? 'text-orange-300' : 'text-fg-3')} />}
      title="Напомняне за серията"
      hint="Писмо вечерта, когато въпросите на деня още чакат, а серията ти ще прекъсне в полунощ. Най-много едно на ден."
      confirmText="Ще ти пишем вечерта, когато въпросите на деня още чакат — най-много веднъж на ден. Спираш го по всяко време оттук или от линка в писмото."
      onToast={{ title: 'Напомнянето е включено', body: 'Ще ти пишем вечерта, ако серията ти е в опасност.' }}
      set={api.setReminders}
    />
  );
}

function BeatenMailSettings() {
  return (
    <MailOptIn
      field="beatenMails"
      icon={(on) => <Swords className={clsx('size-5', on ? 'text-rose-300' : 'text-fg-3')} />}
      title="Писмо, когато те изпреварят"
      hint="Когато някой те изпревари на твой линк с предизвикателство. Най-много едно писмо на ден."
      confirmText="Ще ти пишем, когато някой те изпревари на твой линк с предизвикателство — най-много веднъж на ден. Спираш го по всяко време оттук или от линка в писмото."
      onToast={{ title: 'Включено', body: 'Ще ти пишем, когато някой те изпревари на твой линк.' }}
      set={api.setBeatenMails}
    />
  );
}

const CLAIM_PERKS = [
  'вход от всяко устройство',
  'приятели, свои стаи и предизвикателства',
  'с имейл: нова парола, ако я забравиш, и напомняне за серията',
];

/** Settings for a guest: saving the account (name, password, maybe email) instead of the email and password cards. */
function ClaimSettings() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-amber-300/25 bg-amber-400/[0.06] p-6">
      <div className="flex items-center gap-2">
        <Save className="size-5 text-amber-300" />
        <h2 className="t-card">Запази прогреса</h2>
      </div>
      <p className="mt-1 text-sm text-fg-2">
        Играеш като гост: профилът е само на това устройство. Ако излезеш или изчистиш данните на браузъра, нивото,
        серията и всичко изиграно се губят. С име и парола остават твои — и получаваш:
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-fg-2">
        {CLAIM_PERKS.map((perk) => (
          <li key={perk} className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-300" /> {perk}
          </li>
        ))}
      </ul>
      <Button className="mt-4 w-full sm:w-auto" onClick={() => setOpen(true)}>
        <Save className="size-4" /> Запази профила
      </Button>
      <ClaimAccountModal open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function DataSettings() {
  const guest = useStore((s) => !!s.me?.isGuest);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A guest has no password: being signed in on this device is the proof.
      await api.deleteAccount(guest ? '' : password);
      await forgetThisDevice({ server: false });
      clearSession();
      navigate('/', { replace: true });
      toast({ kind: 'info', title: 'Профилът е изтрит. Довиждане!' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-violet-300" />
        <h2 className="t-card">Твоите данни</h2>
      </div>
      <p className="mt-1 text-sm text-fg-3">
        Виж как ги пазим в{' '}
        <Link to="/privacy" className="text-violet-300 hover:underline">
          Политиката за поверителност
        </Link>
        .
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={api.exportUrl()} download="almanac-data.json" className={buttonClass({ variant: 'secondary' })}>
          <Download className="size-4" /> Изтегли данните си
        </a>
        <Button
          variant="ghost"
          className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-4" /> Изтрий профила
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Изтриване на профила">
        <form noValidate onSubmit={remove} className="space-y-4">
          <p className="text-sm text-fg-2">
            {guest
              ? 'Профилът на гост, нивото, статистиката и постиженията ти ще бъдат изтрити завинаги. Това не може да се отмени.'
              : 'Профилът, нивото, статистиката, постиженията и приятелите ти ще бъдат изтрити завинаги. Това не може да се отмени.'}
          </p>
          {!guest && (
            <PasswordField
              label="Потвърди с паролата си"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отказ
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!guest && !password}>
              Изтрий завинаги
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function EmailSettings() {
  const me = useStore((s) => s.me)!;
  const [email, setEmail] = useState('');
  // Whoever controls the email can reset the password, so changing it asks for the password.
  const [password, setPassword] = useState('');
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | 'resend' | null>(null);

  async function save(address: string, kind: 'save' | 'resend') {
    setBusy(kind);
    try {
      const { user } = await api.setEmail(address, kind === 'save' ? password : undefined);
      setState({ me: user });
      setEmail('');
      setPassword('');
      toast({ kind: 'success', icon: '✉️', title: 'Изпратихме линк за потвърждение', body: address });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy('remove');
    try {
      const { user } = await api.removeEmail(password);
      setState({ me: user });
      setPassword('');
      setRemoving(false);
      toast({ kind: 'info', title: 'Имейлът е премахнат' });
    } catch (err) {
      toast({ kind: 'error', title: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Mail className="size-5 text-violet-300" />
        <h2 className="t-card">Имейл</h2>
      </div>
      <p className="mt-1 text-sm text-fg-3">
        За нова парола, ако забравиш старата, и за напомнянето за серията, ако го включиш. Не го показваме на никого.
      </p>

      {me.email && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
          <MailCheck className="size-5 text-emerald-300" />
          <span className="min-w-0 flex-1 truncate font-semibold">{me.email}</span>
          <span className="text-xs font-semibold text-emerald-300">Потвърден</span>
          {!removing && (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
              Премахни
            </Button>
          )}
        </div>
      )}
      {me.email && me.emailBounced && (
        <p className="mt-3 flex items-start gap-2.5 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <MailWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <span>
            Писмата ни до този адрес не стигат (връщат се или са отбелязани като спам), затова спряхме напомнянията.
            Провери адреса или добави друг.
          </span>
        </p>
      )}
      {me.email && removing && (
        <form noValidate onSubmit={remove} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-full min-w-0 sm:flex-1">
            <Field label="Парола за потвърждение" htmlFor={`${EMAIL_INPUT_ID}-remove`}>
              <input
                id={`${EMAIL_INPUT_ID}-remove`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                autoComplete="current-password"
                className={INPUT}
              />
            </Field>
          </div>
          <Button type="submit" variant="danger" size="field" loading={busy === 'remove'}>
            Премахни имейла
          </Button>
          <Button type="button" variant="ghost" size="field" onClick={() => setRemoving(false)}>
            Отказ
          </Button>
        </form>
      )}
      {me.pendingEmail && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 basis-56">
            Чака потвърждение: <b>{me.pendingEmail}</b>
            <span className="block text-xs text-fg-3">Отвори линка от писмото (провери и папката за спам).</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => save(me.pendingEmail!, 'resend')}
            loading={busy === 'resend'}
          >
            Изпрати отново
          </Button>
        </div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(email.trim(), 'save');
        }}
        className="mt-4 flex flex-wrap items-end gap-2"
      >
        {/* Phones: one field per row; wider screens: side by side. Labels stay visible (a placeholder goes as you type). */}
        <div className="w-full min-w-0 sm:flex-1">
          <Field label={me.email ? 'Нов имейл' : 'Имейл'} htmlFor={EMAIL_INPUT_ID}>
            <input
              id={EMAIL_INPUT_ID}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
              placeholder="твоят@имейл.bg"
              className={INPUT}
            />
          </Field>
        </div>
        <div className="w-full min-w-0 sm:flex-1">
          <Field label="Парола за потвърждение" htmlFor={`${EMAIL_INPUT_ID}-password`}>
            <input
              id={`${EMAIL_INPUT_ID}-password`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="current-password"
              className={INPUT}
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" size="field" className="w-full sm:w-auto" loading={busy === 'save'}>
          {me.email ? 'Смени' : 'Добави'}
        </Button>
      </form>
    </Card>
  );
}

function PasswordSettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < PASSWORD_MIN_LENGTH)
      return setError(`Новата парола трябва да е поне ${PASSWORD_MIN_LENGTH} символа.`);
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      toast({ kind: 'success', title: 'Паролата е сменена', body: 'Другите устройства са отписани.' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-violet-300" />
        <h2 className="t-card">Парола</h2>
      </div>
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <PasswordField label="Текуща парола" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField
          label="Нова парола"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          placeholder={`поне ${PASSWORD_MIN_LENGTH} символа`}
        />
        {error && (
          <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" loading={busy}>
          Смени паролата
        </Button>
      </form>
    </Card>
  );
}
