import { api, errorMessage, onSecondFactorNeeded } from '@quiz/client';
import { Check, Copy, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Button, Card, Field, INPUT, Modal } from './ui';

/**
 * Staff sign in to /admin with a second factor: a six-digit code from an authenticator app (Google Authenticator,
 * Microsoft Authenticator, Aegis, 1Password…), once per session and again every 12 hours. A stolen password alone
 * moderates nothing.
 */

/** The six digits: a field phones fill from the app (one-time-code) and keyboards type into. */
function CodeField({
  code,
  onChange,
  error,
  label = 'Код от приложението',
}: {
  code: string;
  onChange: (code: string) => void;
  error: string | null;
  label?: string;
}) {
  const id = useId();
  return (
    <div>
      <Field label={label} htmlFor={id}>
        <input
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
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}

/** This session's code: `onDone` once it's taken. */
export function CodeForm({ onDone }: { onDone: () => void }) {
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
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>
        <ShieldCheck className="size-4.5" /> Влез в модерацията
      </Button>
    </form>
  );
}

/** Where /admin starts for a staff member without a code this session: set an app up, or give its code. */
export function SecondFactorGate({ state, onDone }: { state: 'setup' | 'needed'; onDone: () => void }) {
  return (
    <Card className="mx-auto max-w-md p-6 sm:p-8">
      <KeyRound aria-hidden className="size-8 text-emerald-300" />
      {state === 'needed' ? (
        <>
          <h2 className="mt-3 t-section">Код за вход</h2>
          <p className="mt-2 mb-5 text-sm text-fg-2">
            Модерацията иска код от приложението ти за удостоверяване веднъж на 12 часа.
          </p>
          <CodeForm onDone={onDone} />
        </>
      ) : (
        <SecondFactorSetup onDone={onDone} />
      )}
    </Card>
  );
}

/** Setting an app up: a secret for it (shown once: typed in, or opened in the app on this phone), then its first code. */
function SecondFactorSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.setUpSecondFactor());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.enableSecondFactor(code);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
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
        Модерацията иска освен паролата и код от приложение за удостоверяване на телефона ти — Google Authenticator,
        Microsoft Authenticator, Aegis или подобно. Така само откраднатата парола не стига.
      </p>
      {!setup ? (
        <>
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}
          <Button size="lg" className="mt-5 w-full" onClick={() => void start()} loading={busy}>
            <Smartphone className="size-4.5" /> Включи
          </Button>
        </>
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
          <CodeField code={code} onChange={setCode} error={error} />
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>
            <ShieldCheck className="size-4.5" /> Потвърди
          </Button>
          <p className="text-xs text-fg-3">
            Загубен телефон: собственикът нулира влизането от сървъра (<code>cli admin 2fa-reset</code>).
          </p>
        </form>
      )}
    </>
  );
}

/**
 * Asks for a code when a moderator's 12 hours run out mid-session: the change they made goes through once it's given.
 * Mounted once, for the whole app.
 */
export function SecondFactorPrompt() {
  const [answer, setAnswer] = useState<((given: boolean) => void) | null>(null);
  useEffect(() => onSecondFactorNeeded(() => new Promise<boolean>((resolve) => setAnswer(() => resolve))), []);

  function close(given: boolean) {
    answer?.(given);
    setAnswer(null);
  }

  return (
    <Modal open={!!answer} onClose={() => close(false)} title="Код за вход">
      <p className="-mt-2 mb-5 text-sm text-fg-2">
        Модерацията иска код от приложението ти за удостоверяване веднъж на 12 часа.
      </p>
      {answer && <CodeForm onDone={() => close(true)} />}
    </Modal>
  );
}
