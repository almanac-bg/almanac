import { api, errorMessage, refreshMe, useStore } from '@quiz/client';
import { BellOff, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmailLinkPage } from '../components/EmailLinkPage';
import { Button } from '../components/ui';
import { usePageTitle } from '../lib/title';

/** Standalone screen for the email link (works signed in or out), like the other email-link pages. */

// ─── /unsubscribe?u=…&k=… ────────────────────────────────────────────────────

/**
 * The unsubscribe link in streak reminder emails. Nothing happens on load: mail scanners open links to check them, and
 * that mustn't switch anyone's reminders off. The button does it (mail apps' one-click unsubscribe calls the API directly).
 */
export function UnsubscribePage() {
  usePageTitle('Писма по желание');
  const [params] = useSearchParams();
  const u = params.get('u') ?? '';
  const k = params.get('k') ?? '';
  const signedIn = useStore((s) => !!s.me);
  const [state, setLocal] = useState<'idle' | 'working' | 'done' | { error: string }>('idle');

  async function stop() {
    setLocal('working');
    try {
      await api.remindersOff(u, k);
      setLocal('done');
      if (signedIn) void refreshMe(); // the switch in Settings shows it straight away
    } catch (err) {
      setLocal({ error: errorMessage(err) });
    }
  }

  const home = (
    <Link
      to={signedIn ? '/settings' : '/'}
      className="glass focus-ring mt-6 inline-flex h-11 items-center justify-center rounded-2xl px-5 text-[15px] font-semibold hover:bg-tint/10"
    >
      {signedIn ? 'Към настройките' : 'Към играта'}
    </Link>
  );

  if (!u || !k) {
    return (
      <EmailLinkPage>
        <div className="text-center">
          <XCircle className="mx-auto size-12 text-rose-400" />
          <h1 className="mt-3 t-section">Линкът е непълен</h1>
          <p className="mt-2 text-sm text-fg-2">
            Отвори го отново от писмото. Напомнянията се спират и от Настройки, след като влезеш.
          </p>
          {home}
        </div>
      </EmailLinkPage>
    );
  }

  if (state === 'done') {
    return (
      <EmailLinkPage>
        <div role="status" className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-400" />
          <h1 className="mt-3 t-section">Писмата са спрени</h1>
          <p className="mt-2 text-sm text-fg-2">
            Няма да получаваш повече напомняния за серията, нито писма, когато някой те изпревари на твой линк. Ако ги
            искаш обратно, включи ги от Настройки.
          </p>
          {home}
        </div>
      </EmailLinkPage>
    );
  }

  return (
    <EmailLinkPage>
      <BellOff className="size-8 text-violet-300" />
      <h1 className="mt-3 t-section">Писма по желание</h1>
      <p className="mt-2 text-sm text-fg-2">
        Напомнянето за серията и писмото, когато някой те изпревари на твой линк, са по желание. Не ги искаш? Спри ги с
        един бутон — серията и профилът ти остават, както са.
      </p>
      {typeof state === 'object' && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
          {state.error} Отвори линка отново от последното писмо или спри писмата от Настройки.
        </p>
      )}
      <Button size="lg" className="mt-6 w-full" loading={state === 'working'} onClick={stop}>
        <BellOff className="size-4.5" /> Спри писмата
      </Button>
      <Link
        to="/"
        className="focus-ring mx-auto mt-3 flex min-h-11 w-fit items-center rounded-xl px-3 text-sm font-semibold text-fg-3 hover:text-fg"
      >
        Не, остави ги
      </Link>
    </EmailLinkPage>
  );
}
