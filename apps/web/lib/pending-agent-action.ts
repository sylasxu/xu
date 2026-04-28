export type PendingActionAuthMode = "login" | "bind_phone";

export type StructuredPendingAction = {
  type: "structured_action";
  action: string;
  payload: Record<string, unknown>;
  source?: string;
  originalText?: string;
  authMode?: PendingActionAuthMode;
};

export type PendingAgentActionState = {
  action: StructuredPendingAction;
  message?: string;
};

const PENDING_AGENT_ACTION_STORAGE_KEY = "xu:web:pending-agent-action";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPendingActionAuthMode(value: unknown): PendingActionAuthMode | null {
  return value === "login" || value === "bind_phone" ? value : null;
}

export function readStructuredPendingAction(value: unknown): StructuredPendingAction | null {
  if (!isRecord(value) || value.type !== "structured_action") {
    return null;
  }

  const action = readString(value.action);
  const payload = isRecord(value.payload) ? value.payload : null;
  if (!action || !payload) {
    return null;
  }

  const authMode = readPendingActionAuthMode(value.authMode);

  return {
    type: "structured_action",
    action,
    payload,
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.originalText === "string" ? { originalText: value.originalText } : {}),
    ...(authMode ? { authMode } : {}),
  };
}

export function readPendingAgentActionState(value: unknown): PendingAgentActionState | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = readStructuredPendingAction(value.action);
  if (!action) {
    return null;
  }

  return {
    action,
    ...(typeof value.message === "string" && value.message.trim()
      ? { message: value.message.trim() }
      : {}),
  };
}

export function readPendingAgentActionStateFromBrowser(): PendingAgentActionState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_AGENT_ACTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return readPendingAgentActionState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistPendingAgentActionStateInBrowser(state: PendingAgentActionState | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!state) {
    window.sessionStorage.removeItem(PENDING_AGENT_ACTION_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(PENDING_AGENT_ACTION_STORAGE_KEY, JSON.stringify(state));
}
