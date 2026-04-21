export function readClientToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const tokenKeys = ["token", "authToken", "accessToken"];
  for (const key of tokenKeys) {
    const value = window.localStorage.getItem(key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function writeClientToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("token", token);
  window.localStorage.setItem("authToken", token);
  window.localStorage.setItem("accessToken", token);
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new Event("xu-auth-updated"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const normalized = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const decoded = window.atob(`${normalized}${padding}`);
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readClientUserId(token = readClientToken()): string | null {
  if (!token) {
    return null;
  }

  const payload = decodeJwtPayload(token);
  return typeof payload?.id === "string" && payload.id.trim() ? payload.id.trim() : null;
}

export function readClientPhoneNumber(token = readClientToken()): string | null {
  if (!token) {
    return null;
  }

  const payload = decodeJwtPayload(token);
  return typeof payload?.phoneNumber === "string" && payload.phoneNumber.trim()
    ? payload.phoneNumber.trim()
    : null;
}
