import { BRAND } from '@quiz/shared';
import { Link } from 'react-router';

/** Footer links to the legal pages (kept apart from the pages themselves, which load on demand). */
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap items-center gap-x-4 text-xs text-fg-3 ${className}`}>
      <Link to="/terms" className="inline-flex min-h-11 items-center hover:text-fg-2">
        Условия за ползване
      </Link>
      <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-fg-2">
        Политика за поверителност
      </Link>
      <span className="inline-flex min-h-11 items-center">
        © {new Date().getFullYear()} {BRAND.name}
      </span>
    </nav>
  );
}
