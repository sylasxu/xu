"use client";

export const DISCUSSION_STATE_UPDATED_EVENT = "xu:discussion-state-updated";

export type DiscussionStateUpdateReason =
  | "messages_loaded"
  | "message_sent"
  | "message_received";

export type DiscussionStateUpdatePayload = {
  activityId: string;
  reason: DiscussionStateUpdateReason;
  updatedAt: number;
};

const DISCUSSION_STATE_STORAGE_KEY = "xu:web:discussion-state-updated";

export function markDiscussionStateUpdated(
  payload: Omit<DiscussionStateUpdatePayload, "updatedAt">
): DiscussionStateUpdatePayload {
  const nextPayload: DiscussionStateUpdatePayload = {
    ...payload,
    updatedAt: Date.now(),
  };

  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      DISCUSSION_STATE_STORAGE_KEY,
      JSON.stringify(nextPayload)
    );
    window.dispatchEvent(
      new CustomEvent<DiscussionStateUpdatePayload>(
        DISCUSSION_STATE_UPDATED_EVENT,
        { detail: nextPayload }
      )
    );
  }

  return nextPayload;
}

export function readDiscussionStateUpdate(): DiscussionStateUpdatePayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(DISCUSSION_STATE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const payload = JSON.parse(raw) as unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { activityId?: unknown }).activityId === "string" &&
      typeof (payload as { reason?: unknown }).reason === "string" &&
      typeof (payload as { updatedAt?: unknown }).updatedAt === "number"
    ) {
      return payload as DiscussionStateUpdatePayload;
    }
  } catch {
    return null;
  }

  return null;
}
