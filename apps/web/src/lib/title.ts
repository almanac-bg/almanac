import { pageTitle } from '@quiz/shared';
import { useEffect } from 'react';

/** The browser tab's title while this screen is open ("Настройки — АЛМАНАХ"); null is the home page's. */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
