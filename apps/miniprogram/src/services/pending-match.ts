import wxRequest from '../utils/wx-request';

interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface PendingMatchDetailMember {
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  isTempOrganizer: boolean;
  locationHint: string;
  timePreference: string | null;
  tags: string[];
  intentSummary: string;
}

export interface PendingMatchDetailIcebreaker {
  content: string;
  createdAt: string;
}

export interface PendingMatchDetailResponse {
  id: string;
  activityType: string;
  typeName: string;
  requestMode: 'auto_match' | 'connect' | 'group_up';
  matchScore: number;
  commonTags: string[];
  locationHint: string;
  confirmDeadline: string;
  isTempOrganizer: boolean;
  organizerUserId: string;
  organizerNickname: string | null;
  nextActionOwner: 'self' | 'organizer';
  continuationTitle?: string;
  continuationText?: string;
  nextActionText: string;
  matchReasonTitle: string;
  matchReasonText: string;
  deadlineHint: string;
  members: PendingMatchDetailMember[];
  icebreaker: PendingMatchDetailIcebreaker | null;
}

export interface ApiErrorResponse {
  code: number;
  msg: string;
}

export async function getPendingMatchDetail(matchId: string, userId: string): Promise<ApiResponse<PendingMatchDetailResponse | ApiErrorResponse>> {
  return wxRequest<ApiResponse<PendingMatchDetailResponse | ApiErrorResponse>>(
    `/notifications/pending-matches/${matchId}?userId=${encodeURIComponent(userId)}`,
    {
      method: 'GET',
    },
  );
}
