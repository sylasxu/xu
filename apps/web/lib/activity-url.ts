export function buildActivityDetailPath(
  activityId: string,
  params?: {
    entry?: string;
  }
): string {
  const search = new URLSearchParams();
  if (params?.entry) {
    search.set("entry", params.entry);
  }

  const query = search.toString();
  return `/activities/${encodeURIComponent(activityId)}${query ? `?${query}` : ""}`;
}

export function resolveActivityEntry(
  value: unknown,
  fallback?: string
): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }

  return undefined;
}
