import { challengeShareText as shareText } from '@almanac/client';
import { MODES } from '@almanac/shared';

export const challengeUrl = (id: string) => `${window.location.origin}/c/${id}`;

/** What goes into the chat with a challenge link: the score to beat (when there is one) and the link. */
export const challengeShareText = (id: string, score: number | null, questions: number = MODES.challenge.questions) =>
  shareText(window.location.origin, id, score, questions);
