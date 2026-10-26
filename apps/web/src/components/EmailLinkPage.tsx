import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from './NavBar';
import { Card } from './ui';

/** A page an email's link opens (reset the password, confirm the address, unsubscribe): the logo, then one card. */
export function EmailLinkPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-10">
      <Link to="/" className="mb-6 self-center text-3xl">
        <Logo />
      </Link>
      <Card className="bg-ink-2/70 p-6 sm:p-8">{children}</Card>
    </div>
  );
}
