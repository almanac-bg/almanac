import { api, errorMessage, longDate, onSecondFactorNeeded } from '@almanac/client';
import type { StaffSecondFactors } from '@almanac/shared';
import { Check, Copy, Fingerprint, KeyRound, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { addPasskey, passkeyProblem, passkeysWork, signInWithPasskey } from '../lib/passkeys';
import { Button, Card, Field, INPUT, Modal, Spinner } from './ui';

/**
 * Staff sign in to /admin with a second factor, once per session and again every 12 hours: a passkey (Face ID, Touch
 * ID, Windows Hello, a security key: lib/passkeys.ts) or a six-digit code from an authenticator app (Google
 * Authenticator, Microsoft Authenticator, Aegis, 1Password…). A stolen password alone moderates nothing.
 */

/** The six digits: a field phones fill from the app (one-time-code) and keyboards type into. */
function CodeField({
  code,
  onChange,
  error,
  label = 'Код от приложението',
  focus = false,
}: {
  code: string;
  onChange: (code: string) => void;
  error: string | null;
  label?: string;
  /** Take focus when it appears (it replaces the button that had it: focus would drop to the page). */
  focus?: boolean;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on mount only
  useEffect(() => {
    if (focus) field.current?.focus();
  }, []);
  return (
    <div>
      <Field label={label} htmlFor={id}>
        <input
          ref={field}
          id={id}
          value={code}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${INPUT} font-mono text-xl tracking-[0.4em]`}
        />
      </Field>
      {error && <Problem id={`${id}-error`}>{error}</Problem>}
    </div>
  );
}

function Problem({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      {children}
    </p>
  );
}

/** This session's code: `onDone` once it's taken. */
function CodeForm({ onDone, secondary = false }: { onDone: () => void; secondary?: boolean }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.giveSecondFactor(code);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <CodeField code={code} onChange={setCode} error={error} />
      <Button
        type="submit"
        size="lg"
        variant={secondary ? 'secondary' : 'primary'}
        className="w-full"
        loading={busy}
        disabled={code.length !== 6}
      >
        <ShieldCheck className="size-4.5" /> Влез с кода
      </Button>
    </form>
  );
}

/** This session's passkey: the device asks for its own unlocking, `onDone` once the server has taken it. */
function PasskeyButton({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      onDone();
    } catch (err) {
      setError(passkeyProblem(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <Button size="lg" className="w-full" loading={busy} onClick={() => void go()}>
        <Fingerprint className="size-4.5" /> Влез с ключ за достъп
      </Button>
      {error && <Problem>{error}</Problem>}
    </div>
  );
}

/**
 * The second factor for this session, with what this staff member has: their passkey first (nothing to read and type),
 * the app's code beside it.
 */
function GiveSecondFactor({ onDone }: { onDone: () => void }) {
  const [factors, setFactors] = useState<StaffSecondFactors | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.secondFactors().then(setFactors, (err: unknown) => setError(errorMessage(err)));
  }, []);
  if (error) return <Problem>{error}</Problem>;
  if (!factors)
    return (
      <div className="grid place-items-center py-6">
        <Spinner className="size-6 text-emerald-300" />
      </div>
    );
  const keys = factors.passkeys.length > 0 && passkeysWork();
  return (
    <div className="space-y-4">
      {keys && <PasskeyButton onDone={onDone} />}
      {keys && factors.code && <p className="text-center text-sm text-fg-3">или с код от приложението</p>}
      {factors.code && <CodeForm onDone={onDone} secondary={keys} />}
      {!keys && !factors.code && (
        <p className="text-sm text-fg-2">
          Този браузър не може да ползва ключове за достъп. Влез от друг браузър или помоли собственика да нулира
          влизането ти (<code>cli admin 2fa-reset</code>).
        </p>
      )}
    </div>
  );
}

/** Where /admin starts for a staff member without a second factor this session: set one up, or give it. */
export function SecondFactorGate({ state, onDone }: { state: 'setup' | 'needed'; onDone: () => void }) {
  return (
    <Card className="mx-auto max-w-md p-6 sm:p-8">
      <KeyRound aria-hidden className="size-8 text-emerald-300" />
      {state === 'needed' ? (
        <>
          <h2 className="mt-3 t-section">Вход в модерацията</h2>
          <p className="mt-2 mb-5 text-sm text-fg-2">
            Модерацията иска ключа ти за достъп или код от приложението ти веднъж на 12 часа.
          </p>
          <GiveSecondFactor onDone={onDone} />
        </>
      ) : (
        <SecondFactorSetup onDone={onDone} />
      )}
    </Card>
  );
}

/**
 * The first second factor: a passkey where the browser can make one (one touch, nothing to type later), or an
 * authenticator app — a secret for it (shown once: typed in, or opened in the app on this phone), then its first code.
 */
function SecondFactorSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'passkey' | 'app' | null>(null);
  const [copied, setCopied] = useState(false);
  const keys = passkeysWork();

  async function withPasskey() {
    setBusy('passkey');
    setError(null);
    try {
      await addPasskey();
      onDone();
    } catch (err) {
      setError(passkeyProblem(err));
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy('app');
    setError(null);
    try {
      setSetup(await api.setUpSecondFactor());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy('app');
    try {
      await api.enableSecondFactor(code);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
    } catch {
      /* selectable on the page anyway */
    }
  }

  return (
    <>
      <h2 className="mt-3 t-section">Двуфакторно влизане</h2>
      <p className="mt-2 text-sm text-fg-2">
        Модерацията иска освен паролата и втори фактор: ключ за достъп на това устройство (Face ID, Touch ID, Windows
        Hello или ключ за сигурност) или код от приложение за удостоверяване. Така само откраднатата парола не стига.
      </p>
      {!setup ? (
        <div className="mt-5 space-y-3">
          {error && <Problem>{error}</Problem>}
          {keys && (
            <Button size="lg" className="w-full" onClick={() => void withPasskey()} loading={busy === 'passkey'}>
              <Fingerprint className="size-4.5" /> Добави ключ за достъп
            </Button>
          )}
          <Button
            size="lg"
            variant={keys ? 'secondary' : 'primary'}
            className="w-full"
            onClick={() => void start()}
            loading={busy === 'app'}
          >
            <Smartphone className="size-4.5" /> {keys ? 'С приложение за удостоверяване' : 'Включи'}
          </Button>
        </div>
      ) : (
        <form onSubmit={enable} noValidate className="mt-5 space-y-4">
          <ol className="list-decimal space-y-3 pl-5 text-sm text-fg-2">
            <li>
              В приложението добави профил с ключ (или{' '}
              <a href={setup.uri} className="font-semibold text-violet-300 underline">
                го отвори направо
              </a>
              , ако то е на този телефон):
              <span className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-xl bg-sunk/40 px-3 py-2 font-mono text-sm tracking-wider [overflow-wrap:anywhere] text-fg select-all">
                  {setup.secret.match(/.{1,4}/g)?.join(' ')}
                </code>
                <Button size="sm" variant="ghost" type="button" onClick={() => void copy()} aria-label="Копирай ключа">
                  {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                </Button>
              </span>
            </li>
            <li>Напиши шестте цифри, които то показва сега.</li>
          </ol>
          <CodeField code={code} onChange={setCode} error={error} focus />
          <Button type="submit" size="lg" className="w-full" loading={busy === 'app'} disabled={code.length !== 6}>
            <ShieldCheck className="size-4.5" /> Потвърди
          </Button>
        </form>
      )}
      <p className="mt-4 text-xs text-fg-3">
        Загубено устройство: собственикът нулира влизането от сървъра (<code>cli admin 2fa-reset</code>).
      </p>
    </>
  );
}

/**
 * Asks for the second factor when a moderator's 12 hours run out mid-session: the change they made goes through once
 * it's given. Mounted once, for the whole app.
 */
export function SecondFactorPrompt() {
  const [answer, setAnswer] = useState<((given: boolean) => void) | null>(null);
  useEffect(() => onSecondFactorNeeded(() => new Promise<boolean>((resolve) => setAnswer(() => resolve))), []);

  function close(given: boolean) {
    answer?.(given);
    setAnswer(null);
  }

  return (
    <Modal open={!!answer} onClose={() => close(false)} title="Вход в модерацията">
      <p className="-mt-2 mb-5 text-sm text-fg-2">
        Модерацията иска ключа ти за достъп или код от приложението ти веднъж на 12 часа.
      </p>
      {answer && <GiveSecondFactor onDone={() => close(true)} />}
    </Modal>
  );
}

/**
 * A staff member's passkeys in Settings: which devices, added and last used when; one more (on this device), or one
 * removed (a phone sold, a key lost). Both ask for the password given within the hour, as setting up the app does.
 */
export function StaffPasskeys() {
  const [factors, setFactors] = useState<StaffSecondFactors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => api.secondFactors().then(setFactors, (err: unknown) => setError(errorMessage(err)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => void reload(), []);

  async function add() {
    setBusy('add');
    setError(null);
    try {
      await addPasskey();
      await reload();
    } catch (err) {
      setError(passkeyProblem(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.removePasskey(id);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Fingerprint className="size-5 text-emerald-300" />
        <h2 className="t-card">Ключове за достъп до модерацията</h2>
      </div>
      <p className="mt-2 text-sm text-fg-2">
        Вторият фактор за /admin без код за преписване: лице, пръст, ПИН на устройството или ключ за сигурност.
        {factors?.code && ' Приложението за удостоверяване остава включено.'}
      </p>
      {factors && factors.passkeys.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {factors.passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-fg">{p.name}</p>
                <p className="text-xs text-fg-3">
                  добавен {longDate(p.createdAt)}
                  {p.usedAt ? ` · последно ${longDate(p.usedAt)}` : ' · още неползван'}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === p.id}
                onClick={() => void remove(p.id)}
                aria-label={`Премахни ключа „${p.name}“ (добавен ${longDate(p.createdAt)})`}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-4">
          <Problem>{error}</Problem>
        </div>
      )}
      {passkeysWork() ? (
        <Button variant="secondary" className="mt-4" loading={busy === 'add'} onClick={() => void add()}>
          <KeyRound className="size-4" /> Добави ключ на това устройство
        </Button>
      ) : (
        <p className="mt-4 text-sm text-fg-3">Този браузър не може да прави ключове за достъп.</p>
      )}
    </Card>
  );
}
