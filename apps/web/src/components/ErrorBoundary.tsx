import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { useLocation } from 'react-router';
import { reportCrash } from '../lib/monitoring';
import { retryFailedPages } from '../pages/lazy';
import { Background } from './Background';
import { Emoji } from './Emoji';
import { Button, Card } from './ui';

/** What the browsers say when a page's code didn't arrive (a network blip, a deploy that took the file away). */
const CHUNK_FAILURE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/;

/** A page whose code didn't arrive: no bug of ours to report, and worth trying again. */
export const isChunkFailure = (error: unknown) => error instanceof Error && CHUNK_FAILURE.test(error.message);

/**
 * A crash shows a way out instead of a blank page, and is reported (lib/monitoring.ts). `page`: one page's own (inside
 * the app, so the nav, the toasts and the connection stay): a page whose code didn't arrive says so and can be tried
 * again (`onRetry` remounts it, which imports it anew); a navigation clears it (`resetKey`). Otherwise the whole app's,
 * the last resort.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; page?: boolean; resetKey?: string; retryLabel?: string; onRetry?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!isChunkFailure(error)) reportCrash('render', error, info.componentStack ?? undefined);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkFailure(error);
    const card = (
      <Card className="max-w-md p-8 text-center">
        <div className="text-5xl">
          <Emoji e={chunk ? '📡' : '🧯'} />
        </div>
        <h1 className="mt-4 t-section">{chunk ? 'Страницата не се зареди' : 'Нещо се обърка'}</h1>
        <p className="mt-2 text-fg-2">
          {chunk
            ? 'Връзката прекъсна, докато се зареждаше, или играта току-що се обнови. Опитай пак — ако не стане, презареди.'
            : 'Получихме сигнал за грешката и ще я оправим. Профилът и прогресът ти са запазени.'}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {this.props.page && this.props.onRetry && (
            <Button size="lg" onClick={this.props.onRetry}>
              {this.props.retryLabel ?? 'Опитай пак'}
            </Button>
          )}
          <Button
            size="lg"
            variant={this.props.page ? 'secondary' : 'primary'}
            onClick={() => window.location.assign('/')}
          >
            Презареди
          </Button>
        </div>
      </Card>
    );
    if (this.props.page) return <div className="grid min-h-[60dvh] place-items-center py-8">{card}</div>;
    return (
      <div className="grid min-h-dvh place-items-center px-5">
        <Background />
        {card}
      </div>
    );
  }
}

/**
 * Around the pages: a crash in one stays in it. Moving to another page clears it; „Опитай пак“ mounts it anew (a match
 * keeps going meanwhile: the connection lives outside, so „Обратно към мача“ is just that).
 */
export function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [attempt, setAttempt] = useState(0);
  return (
    <ErrorBoundary
      key={attempt}
      page
      resetKey={pathname}
      retryLabel={pathname === '/game' ? 'Обратно към мача' : undefined}
      onRetry={() => {
        retryFailedPages();
        setAttempt((a) => a + 1);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
