import { verifyAuth } from '../../../setup';

export type ActorSource = 'web' | 'miniprogram' | 'admin' | 'unknown';

export interface ActorContext {
  userId: string | null;
  role: string;
  scopes: string[];
  source: ActorSource;
  isAuthenticated: boolean;
}

function getHeaderValue(
  headers: Record<string, string | undefined>,
  targetName: string
): string | undefined {
  const normalizedName = targetName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName && value) {
      return value;
    }
  }
  return undefined;
}

function normalizeScopes(scopes: unknown): string[] {
  if (Array.isArray(scopes)) {
    return scopes.filter((scope): scope is string => typeof scope === 'string');
  }
  if (typeof scopes === 'string') {
    return scopes
      .split(',')
      .map(scope => scope.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSource(source: unknown): ActorSource {
  if (source === 'web' || source === 'miniprogram' || source === 'admin') {
    return source;
  }
  return 'unknown';
}

function inferSource(
  headers: Record<string, string | undefined>,
  role?: string
): ActorSource {
  const fromHeader = getHeaderValue(headers, 'x-client')
    || getHeaderValue(headers, 'x-source');
  const normalizedFromHeader = normalizeSource(fromHeader);
  if (normalizedFromHeader !== 'unknown') {
    return normalizedFromHeader;
  }
  if (role === 'admin') {
    return 'admin';
  }
  return 'unknown';
}

type TokenProfile = {
  id: string;
  role?: string;
  scopes?: unknown;
  source?: unknown;
  client?: unknown;
};

export async function buildActorContext(
  jwt: any,
  headers: Record<string, string | undefined>
): Promise<ActorContext> {
  const profile = await verifyAuth(jwt, headers);
  if (!profile) {
    return {
      userId: null,
      role: 'guest',
      scopes: [],
      source: inferSource(headers),
      isAuthenticated: false,
    };
  }

  const tokenProfile = profile as TokenProfile;
  const role = tokenProfile.role || 'user';
  const preferredSource = tokenProfile.source ?? tokenProfile.client;

  return {
    userId: profile.id,
    role,
    scopes: normalizeScopes(tokenProfile.scopes),
    source: normalizeSource(preferredSource) !== 'unknown'
      ? normalizeSource(preferredSource)
      : inferSource(headers, role),
    isAuthenticated: true,
  };
}
