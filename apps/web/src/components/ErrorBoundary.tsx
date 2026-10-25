import { reportError } from '@quiz/client';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureError } from '../lib/monitoring';
import { Background } from './Background';
import { Button, Card } from './ui';

/** A crash anywhere in the app shows a way out instead of a blank page, and lands in the server log. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError('render', error, info.componentStack ?? undefined);
    captureError(error);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center px-5">
        <Background />
        <Card className="max-w-md p-8 text-center">
          <div className="text-5xl">🧯</div>
          <h1 className="mt-4 t-section">Нещо се обърка</h1>
          <p className="mt-2 text-fg-2">
            Получихме сигнал за грешката и ще я оправим. Презареди страницата, за да продължиш — профилът и прогресът ти
            са запазени.
          </p>
          <Button className="mt-6" size="lg" onClick={() => window.location.assign('/')}>
            Презареди
          </Button>
        </Card>
      </div>
    );
  }
}
