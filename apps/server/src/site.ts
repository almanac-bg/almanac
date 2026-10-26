import type { SiteInfo } from '@quiz/shared';
import { config } from './config';
import { questionBank } from './questions';

/**
 * What every page says about the site (see SiteInfo): taken once at startup, like the pages the server draws from it,
 * so a drawn page and the app that takes it over agree. The question count is rounded down to the hundred: it's a
 * claim on the landing page ("над 1 900 въпроса") that stays true as questions are added or hidden.
 */
export const siteInfo: SiteInfo = {
  ...config.operator,
  sourceUrl: config.sourceUrl,
  release: config.release,
  questions: Math.floor(questionBank().length / 100) * 100,
};
