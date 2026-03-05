import type { ActorContext } from './actor-context';
import { buildActorContext } from './actor-context';

export type AICapability =
  | 'ai.chat.invoke'
  | 'ai.session.read.self'
  | 'ai.session.read.any'
  | 'ai.session.evaluate'
  | 'ai.retrieval.read'
  | 'ai.retrieval.index.rebuild'
  | 'ai.memory.read'
  | 'ai.security.read'
  | 'ai.security.word.write'
  | 'ai.config.read'
  | 'ai.config.write'
  | 'ai.metrics.read';

type Role = 'guest' | 'user' | 'admin';

const ALL_CAPABILITIES: AICapability[] = [
  'ai.chat.invoke',
  'ai.session.read.self',
  'ai.session.read.any',
  'ai.session.evaluate',
  'ai.retrieval.read',
  'ai.retrieval.index.rebuild',
  'ai.memory.read',
  'ai.security.read',
  'ai.security.word.write',
  'ai.config.read',
  'ai.config.write',
  'ai.metrics.read',
];

const ROLE_CAPABILITY_MAP: Record<Role, Set<AICapability>> = {
  guest: new Set<AICapability>(),
  user: new Set<AICapability>([
    'ai.chat.invoke',
    'ai.session.read.self',
  ]),
  admin: new Set<AICapability>(ALL_CAPABILITIES),
};

function isRole(value: string): value is Role {
  return value === 'guest' || value === 'user' || value === 'admin';
}

function hasScopedCapability(scopes: string[], capability: AICapability): boolean {
  if (scopes.includes('*') || scopes.includes('ai.*') || scopes.includes(capability)) {
    return true;
  }

  const segments = capability.split('.');
  if (segments.length < 2) {
    return false;
  }

  const level1Prefix = `${segments[0]}.${segments[1]}.*`;
  const level2Prefix = segments.length >= 3
    ? `${segments[0]}.${segments[1]}.${segments[2]}.*`
    : undefined;

  return scopes.includes(level1Prefix) || (level2Prefix ? scopes.includes(level2Prefix) : false);
}

export function hasCapability(actorContext: ActorContext, capability: AICapability): boolean {
  const role = isRole(actorContext.role) ? actorContext.role : 'guest';
  const roleCapabilities = ROLE_CAPABILITY_MAP[role];
  if (roleCapabilities.has(capability)) {
    return true;
  }
  return hasScopedCapability(actorContext.scopes, capability);
}

type CapabilityGuardInput = {
  capability: AICapability;
  jwt: any;
  headers: Record<string, string | undefined>;
  set: { status?: number | string };
};

export async function requireCapability(
  input: CapabilityGuardInput
): Promise<{ actorContext?: ActorContext; error?: { code: number; msg: string } }> {
  const actorContext = await buildActorContext(input.jwt, input.headers);

  if (!actorContext.isAuthenticated || !actorContext.userId) {
    input.set.status = 401;
    return { error: { code: 401, msg: '未授权' } };
  }

  if (!hasCapability(actorContext, input.capability)) {
    input.set.status = 403;
    return { error: { code: 403, msg: '无权限访问' } };
  }

  return { actorContext };
}
