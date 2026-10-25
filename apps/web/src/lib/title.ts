import { pageTitle } from '@quiz/shared';
import { useEffect } from 'react';

/**
 * The browser tab's title while this screen is open ("Настройки — АЛМАНАХ"); null is the home page's, and undefined
 * keeps the one the server put in the page.
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title !== undefined) document.title = pageTitle(title);
  }, [title]);
}
