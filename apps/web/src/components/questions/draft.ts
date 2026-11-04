import { SUBMISSION_LABELS } from '@almanac/client';
import type { SubmissionStatus } from '@almanac/shared';

export {
  cleanDraft,
  type DraftErrors,
  draftsEqual,
  emptyQuestionDraft as emptyDraft,
  hasErrors,
  toQuestionDraft as toDraft,
  validateDraft,
} from '@almanac/client';

const STATUS_CLASS: Record<SubmissionStatus, string> = {
  pending: 'bg-amber-400/15 text-amber-300',
  approved: 'bg-emerald-400/15 text-emerald-300',
  rejected: 'bg-rose-500/15 text-rose-300',
};

export const SUBMISSION_STATUS: Record<SubmissionStatus, { label: string; className: string }> = {
  pending: { label: SUBMISSION_LABELS.pending, className: STATUS_CLASS.pending },
  approved: { label: SUBMISSION_LABELS.approved, className: STATUS_CLASS.approved },
  rejected: { label: SUBMISSION_LABELS.rejected, className: STATUS_CLASS.rejected },
};
