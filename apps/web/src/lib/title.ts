import { PUBLIC_PAGES, pageTitle } from '@quiz/shared';
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

/**
 * A public page's tab title: the one the server draws it with (PUBLIC_PAGES), written for search ("…с отговори"), so
 * the app shows the same one instead of a shorter name of its own — also when it's reached inside the app.
 */
export function usePublicPageTitle(path: string) {
  useEffect(() => {
    if (Object.hasOwn(PUBLIC_PAGES, path)) document.title = PUBLIC_PAGES[path].title;
  }, [path]);
}
