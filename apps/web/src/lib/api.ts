import type {
  AchievementProgress,
  DailyInfo,
  FriendsResponse,
  LeaderboardBoard,
  LeaderboardResponse,
  Loadout,
  MeUser,
  ProfileStats,
  QuestionDraft,
  SeasonInfo,
  Submission,
  SubmissionStatus,
} from '@quiz/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Нещо се обърка. Опитай пак.', res.status);
  return data as T;
}

export const api = {
  me: () => request<{ user: MeUser | null }>('GET', '/me'),
  login: (username: string, password: string) => request<{ user: MeUser }>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string, email?: string) =>
    request<{ user: MeUser }>('POST', '/auth/register', { username, password, email }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  forgotPassword: (login: string) => request<{ ok: true }>('POST', '/auth/forgot', { login }),
  resetPassword: (token: string, password: string) => request<{ user: MeUser }>('POST', '/auth/reset', { token, password }),
  verifyEmail: (token: string) => request<{ ok: true }>('POST', '/auth/verify-email', { token }),
  setEmail: (email: string) => request<{ user: MeUser }>('POST', '/account/email', { email }),
  removeEmail: () => request<{ user: MeUser }>('DELETE', '/account/email'),
  changePassword: (current: string, next: string) => request<{ ok: true }>('POST', '/account/password', { current, next }),
  loadout: (patch: Partial<Loadout>) => request<{ user: MeUser }>('PATCH', '/me/loadout', patch),
  achievements: () => request<{ achievements: AchievementProgress[] }>('GET', '/achievements'),
  profile: (username: string) => request<ProfileStats>('GET', `/profile/${encodeURIComponent(username)}`),
  leaderboard: (board: LeaderboardBoard) => request<LeaderboardResponse>('GET', `/leaderboard/${board}`),

  daily: () => request<DailyInfo>('GET', '/daily'),
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
