import { BRAND } from '@quiz/shared';
import { Link } from 'react-router';

/** Footer links to the legal pages (kept apart from the pages themselves, which load on demand). */
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3 ${className}`}>
      <Link to="/terms" className="hover:text-fg-2">
        Условия за ползване
      </Link>
      <Link to="/privacy" className="hover:text-fg-2">
        Политика за поверителност
      </Link>
      <span>
        © {new Date().getFullYear()} {BRAND.name}
      </span>
    </nav>
  );
}
