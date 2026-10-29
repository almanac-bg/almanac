import { Router } from 'express';
import { accountRouter } from './account';
import { adminRouter } from './admin';
import { authRouter } from './auth';
import { communityRouter } from './community';
import { playRouter } from './play';
import { profilesRouter } from './profiles';
import { progress } from './progress';
import { setsRouter } from './sets';
import { siteRouter } from './site';
import { socialRouter } from './social';

/** The JSON API under /api, one router per area. */
export const api = Router();
api.use(progress, adminRouter, setsRouter);
api.use(authRouter, siteRouter, accountRouter, playRouter, socialRouter, communityRouter, profilesRouter);
