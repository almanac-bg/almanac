import { BRAND } from '@quiz/shared';
import { Link } from 'react-router';
import { useOperator } from '../lib/operator';

/** Small print where an account is made: under 14 (Bulgaria's age of consent online) the terms ask for a parent's. */
export const MINORS_NOTICE =
  'Ако си под 14 години, за профил и за имейл напомнянията е нужно съгласие на родител или настойник.';

/** Footer links to the legal pages (kept apart from the pages themselves, which load on demand). */
export function LegalLinks({ className = '' }: { className?: string }) {
  // The source code, once published: free software, and the AGPL asks a hosted copy to offer it.
  const sourceUrl = useOperator()?.sourceUrl;
  return (
    <nav className={`flex flex-wrap items-center gap-x-4 text-xs text-fg-3 ${className}`}>
      <Link to="/terms" className="inline-flex min-h-11 items-center hover:text-fg-2">
        Условия за ползване
      </Link>
      <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-fg-2">
        Политика за поверителност
      </Link>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 items-center hover:text-fg-2"
        >
          Изходен код
        </a>
      )}
      <span className="inline-flex min-h-11 items-center">
        © {new Date().getFullYear()} {BRAND.name}
      </span>
    </nav>
  );
}
