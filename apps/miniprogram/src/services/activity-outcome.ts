import wxRequest from '../utils/wx-request';

interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface ActionResponse {
  code: number;
  msg: string;
}

export interface ApiErrorResponse {
  code: number;
  msg: string;
}

export async function postActivityRebookFollowUp(activityId: string): Promise<ApiResponse<ActionResponse | ApiErrorResponse>> {
  return wxRequest<ApiResponse<ActionResponse | ApiErrorResponse>>('/participants/rebook-follow-up', {
    method: 'POST',
    body: JSON.stringify({ activityId }),
  });
}
