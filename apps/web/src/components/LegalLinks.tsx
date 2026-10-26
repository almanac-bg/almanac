import { BRAND } from '@quiz/shared';
import { Link } from 'react-router';
import { useSite } from '../lib/site';

/** Small print where an account is made: under 14 (Bulgaria's age of consent online) the terms ask for a parent's. */
export const MINORS_NOTICE =
  'Ако си под 14 години, за профил и за напомнянията по имейл е нужно съгласие на родител или настойник.';

/** Footer links to the legal pages (kept apart from the pages themselves, which load on demand). */
export function LegalLinks({ className = '' }: { className?: string }) {
  // The source code, once published: free software, and the AGPL asks a hosted copy to offer it.
  const op = useSite();
  // The exact version that's running, as the AGPL asks (the repository's front page may be ahead of it).
  const source = op?.sourceUrl?.startsWith('https://')
    ? op.release
      ? `${op.sourceUrl}/tree/${encodeURIComponent(op.release)}`
      : op.sourceUrl
    : null;
  return (
    <nav
      aria-label="Правна информация"
      className={`flex flex-wrap items-center gap-x-4 text-xs text-fg-3 ${className}`}
    >
      <Link to="/terms" className="inline-flex min-h-11 items-center hover:text-fg-2">
        Условия за ползване
      </Link>
      <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-fg-2">
        Политика за поверителност
      </Link>
      {source && (
        <a href={source} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center hover:text-fg-2">
          Изходен код
        </a>
      )}
      <span className="inline-flex min-h-11 items-center">
        © {new Date().getFullYear()} {BRAND.name}
      </span>
    </nav>
  );
}
