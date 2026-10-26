import type {
  AchievementProgress,
  ChallengeInfo,
  ChallengePreview,
  DailyInfo,
  FriendsResponse,
  LaunchStats,
  LeaderboardBoard,
  LeaderboardResponse,
  Loadout,
  MeUser,
  ModerationAction,
  MyChallenge,
  OperatorInfo,
  ProfileStats,
  QuestionDraft,
  QuestionInfo,
  QuestionReportAction,
  QuestionReportGroup,
  QuestionReportReason,
  ReportGroup,
  ReportReason,
  SeasonInfo,
  Submission,
  SubmissionStatus,
} from '@quiz/shared';
import { clientConfig } from './config';

export interface QuestionReports {
  groups: QuestionReportGroup[];
  hidden: QuestionInfo[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * What to tell the player about a failure: the server's own words for a failed request (they're written for players,
 * in Bulgarian), the fallback for anything else (a bug's message is in English and means nothing to them).
 */
export function errorMessage(err: unknown, fallback = 'Нещо се обърка.') {
  return err instanceof ApiError ? err.message : fallback;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${clientConfig().baseUrl}/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Няма връзка със сървъра. Провери интернета си.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Нещо се обърка. Опитай пак.', res.status);
  return data as T;
}

export const api = {
  me: () => request<{ user: MeUser | null }>('GET', '/me'),
  operator: () => request<OperatorInfo>('GET', '/legal'),
  login: (username: string, password: string) =>
    request<{ user: MeUser }>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string, email?: string) =>
    request<{ user: MeUser }>('POST', '/auth/register', { username, password, email }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  /** Play first, sign up later: a guest account on this device. */
  guest: () => request<{ user: MeUser }>('POST', '/auth/guest'),
  /** A guest picks a name and password; everything played so far stays. */
  claim: (username: string, password: string, email?: string) =>
    request<{ user: MeUser }>('POST', '/account/claim', { username, password, email: email || undefined }),
  setReminders: (on: boolean) => request<{ user: MeUser }>('POST', '/account/reminders', { on }),
  /** From the reminder email's unsubscribe link (works signed out). */
  remindersOff: (u: string, k: string) =>
    request<{ ok: true }>('POST', `/reminders/off?u=${encodeURIComponent(u)}&k=${encodeURIComponent(k)}`),
  forgotPassword: (login: string) => request<{ ok: true }>('POST', '/auth/forgot', { login }),
  resetPassword: (token: string, password: string) =>
    request<{ user: MeUser }>('POST', '/auth/reset', { token, password }),
  verifyEmail: (token: string) => request<{ ok: true }>('POST', '/auth/verify-email', { token }),
  /** A new address needs the password; re-sending the link to the pending one doesn't. */
  setEmail: (email: string, password?: string) =>
    request<{ user: MeUser }>('POST', '/account/email', { email, password }),
  removeEmail: (password: string) => request<{ user: MeUser }>('DELETE', '/account/email', { password }),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>('POST', '/account/password', { current, next }),
  deleteAccount: (password: string) => request<{ ok: true }>('POST', '/account/delete', { password }),
  /** Where the browser downloads the data export (the session cookie authenticates it). */
  exportUrl: () => `${clientConfig().baseUrl}/api/account/export`,

  report: (username: string, reason: ReportReason, details: string) =>
    request<{ ok: true }>('POST', '/reports', { username, reason, details }),
  adminSummary: () =>
    request<{ pendingQuestions: number; openReports: number; questionReports: number }>('GET', '/admin/summary'),
  reportQuestion: (questionId: string, reason: QuestionReportReason, details: string) =>
    request<{ ok: true }>('POST', `/questions/${encodeURIComponent(questionId)}/report`, { reason, details }),
  adminQuestionReports: () => request<QuestionReports>('GET', '/admin/question-reports'),
  adminStats: () => request<LaunchStats>('GET', '/admin/stats'),
  resolveQuestionReports: (questionId: string, action: QuestionReportAction) =>
    request<QuestionReports>('POST', `/admin/question-reports/${encodeURIComponent(questionId)}/resolve`, { action }),
  unhideQuestion: (questionId: string) =>
    request<QuestionReports>('POST', `/admin/hidden-questions/${encodeURIComponent(questionId)}/unhide`),
  adminReports: () => request<{ groups: ReportGroup[] }>('GET', '/admin/reports'),
  resolveReports: (userId: number, decision: ModerationAction) =>
    request<{ ok: true; groups: ReportGroup[] }>('POST', `/admin/reports/${userId}/resolve`, decision),

  loadout: (patch: Partial<Loadout>) => request<{ user: MeUser }>('PATCH', '/me/loadout', patch),
  achievements: () => request<{ achievements: AchievementProgress[] }>('GET', '/achievements'),
  profile: (username: string) => request<ProfileStats>('GET', `/profile/${encodeURIComponent(username)}`),
  leaderboard: (board: LeaderboardBoard) => request<LeaderboardResponse>('GET', `/leaderboard/${board}`),

  daily: () => request<DailyInfo>('GET', '/daily'),
  myChallenges: () => request<{ challenges: MyChallenge[] }>('GET', '/challenges'),
  challenge: (id: string) => request<ChallengeInfo>('GET', `/challenges/${encodeURIComponent(id)}`),
  challengePreview: (id: string) => request<ChallengePreview>('GET', `/challenges/${encodeURIComponent(id)}/preview`),
  season: () => request<SeasonInfo>('GET', '/season'),
  seasonSeen: () => request<{ ok: true }>('POST', '/season/seen'),

  friends: () => request<FriendsResponse>('GET', '/friends'),
  addFriend: (username: string) => request<FriendsResponse>('POST', '/friends', { username }),
  acceptFriend: (userId: number) => request<FriendsResponse>('POST', `/friends/${userId}/accept`),
  removeFriend: (userId: number) => request<FriendsResponse>('DELETE', `/friends/${userId}`),

  mySubmissions: () => request<{ submissions: Submission[] }>('GET', '/submissions/mine'),
  submitQuestion: (draft: QuestionDraft) => request<{ submission: Submission }>('POST', '/submissions', draft),
  adminSubmissions: (status: SubmissionStatus) =>
    request<{ submissions: Submission[]; pending: number }>('GET', `/admin/submissions?status=${status}`),
  approveSubmission: (id: number, edits: QuestionDraft | null) =>
    request<{ ok: true; pending: number }>('POST', `/admin/submissions/${id}/approve`, { edits }),
  rejectSubmission: (id: number, reason: string) =>
    request<{ ok: true; pending: number }>('POST', `/admin/submissions/${id}/reject`, { reason }),
};
