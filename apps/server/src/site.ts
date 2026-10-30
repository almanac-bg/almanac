import type { SiteInfo } from '@quiz/shared';
import { config } from './config';
import { imageBank, numberBank, orderBank, questionBank } from './questions';

/**
 * What every page says about the site (see SiteInfo): taken once at startup, like the pages the server draws from it,
 * so a drawn page and the app that takes it over agree. The question count is rounded down to the hundred: it's a
 * claim on the landing page ("над 1 900 въпроса") that stays true as questions are added or hidden.
 */
export const siteInfo: SiteInfo = {
  ...config.operator,
  sourceUrl: config.sourceUrl,
  release: config.release,
  // Every format in play: with options, with a picture, a number, an order.
  questions:
    Math.floor((questionBank().length + imageBank().length + numberBank().length + orderBank().length) / 100) * 100,
  year: new Date().getFullYear(),
  monitoring: !!config.sentryDsn,
  push: !!config.vapid,
};
