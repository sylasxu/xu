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
