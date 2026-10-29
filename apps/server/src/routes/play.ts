import { type Request, Router } from 'express';
import { requireAuth } from '../auth';
import { challengeInfo, challengePreview, myChallenges } from '../challenges';
import { dailyInfo, dailyLink, dailyPreview } from '../daily';
import { eveningInfo } from '../evening';
import { markSeasonRewardsSeen, seasonInfo } from '../seasons';
import { count } from '../stats';
import { network, throttled } from '../throttle';

/** Challenge links, the questions of the day, the evening Роял and the seasons. */
export const playRouter = Router();

const challengeId = (req: Request) => String(req.params.id).slice(0, 16);

playRouter.get('/challenges', requireAuth, (_req, res) => {
  res.json({ challenges: myChallenges(res.locals.userId) });
});

/** Signed out too: the link's landing page shows who's challenging and the score to beat. */
playRouter.get('/challenges/:id/preview', (req, res) => {
  if (throttled(`challenge-preview:${network(req.ip)}`, 120, 60_000)) {
    res.status(429).json({ error: 'Твърде много заявки.' });
    return;
  }
  const preview = challengePreview(challengeId(req));
  if (preview) count('link_opens:challenge');
  if (!preview) {
    res.status(404).json({ error: 'Няма такова предизвикателство.' });
    return;
  }
  res.json(preview);
});

playRouter.get('/challenges/:id', requireAuth, (req, res) => {
  const info = challengeInfo(challengeId(req), res.locals.userId);
  if (!info) {
    res.status(404).json({ error: 'Няма такова предизвикателство.' });
    return;
  }
  res.json(info);
});

playRouter.get('/daily', requireAuth, (_req, res) => {
  res.json(dailyInfo(res.locals.userId));
});

/** A daily link as anyone sees it, signed in or not (`code` optional: /daily itself). */
playRouter.get('/daily/preview', (req, res) => {
  if (throttled(`daily-preview:${network(req.ip)}`, 120, 60_000)) {
    res.status(429).json({ error: 'Твърде много заявки.' });
    return;
  }
  const code = typeof req.query.code === 'string' ? req.query.code.slice(0, 16) : null;
  const preview = dailyPreview(code);
  if (code && preview.sharer) count('link_opens:daily');
  res.json(preview);
});

/** The player's link to today's questions, to send around; made once they've played today. */
playRouter.post('/daily/link', requireAuth, (_req, res) => {
  const code = dailyLink(res.locals.userId);
  if (!code) {
    res.status(409).json({ error: 'Изиграй днешните въпроси, за да ги пратиш на някого.' });
    return;
  }
  res.json({ code });
});

/** Tonight's evening Роял (whether you're in its lobby) and the last one's top. */
playRouter.get('/evening', requireAuth, (_req, res) => {
  res.json(eveningInfo(res.locals.userId));
});

playRouter.get('/season', requireAuth, (_req, res) => {
  res.json(seasonInfo(res.locals.userId));
});

playRouter.post('/season/seen', requireAuth, (_req, res) => {
  markSeasonRewardsSeen(res.locals.userId);
  res.json({ ok: true });
});
