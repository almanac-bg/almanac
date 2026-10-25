import clsx from 'clsx';
import { Link } from 'react-router';
import { Logo } from '../components/NavBar';
import { buttonClass, Card } from '../components/ui';
import { usePageTitle } from '../lib/title';

/**
 * An address that isn't part of the site (the server answers it with a 404). `standalone`: signed out, without the
 * app's header around it.
 */
export function NotFoundPage({ standalone = false }: { standalone?: boolean }) {
  usePageTitle('Страницата не съществува');
  return (
    <div className={clsx('mx-auto grid max-w-md place-items-center text-center', standalone ? 'px-4 py-16' : 'py-10')}>
      {standalone && (
        <Link to="/" className="mb-8 text-3xl">
          <Logo />
        </Link>
      )}
      <Card className="w-full p-8">
        <p className="text-gradient font-display text-6xl font-black" aria-hidden>
          404
        </p>
        <h1 className="mt-4 t-section">Тази страница не съществува</h1>
        <p className="mt-2 text-sm text-fg-2">Може линкът да е непълен или страницата вече да я няма.</p>
        <Link to="/" className={clsx(buttonClass({ size: 'lg' }), 'mt-6 w-full')}>
          Към началото
        </Link>
      </Card>
    </div>
  );
}
