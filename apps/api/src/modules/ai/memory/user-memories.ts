import { db, userMemories, eq, and } from '@juchang/db';
import { generateEmbedding } from '../rag';
import type { PreferenceExtraction } from './extractor';

type PersistentMemoryType = 'preference' | 'profile_fact' | 'social_context';

interface PersistentUserMemoryInput {
  memoryType: PersistentMemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  importance?: number;
}

function uniqNonEmpty(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function toPersistentMemoryInputs(extraction: PreferenceExtraction): PersistentUserMemoryInput[] {
  const preferenceEntries = extraction.preferences
    .map((item) => item.value.trim())
    .filter(Boolean)
    .map((value) => ({
      memoryType: 'preference' as const,
      content: value,
      metadata: { source: 'extract-preferences', category: 'preference' },
      importance: 2,
    }));

  const identityEntries = uniqNonEmpty(extraction.identityFacts).map((content) => ({
    memoryType: 'profile_fact' as const,
    content,
    metadata: { source: 'extract-preferences', category: 'identity_fact' },
    importance: 3,
  }));

  const socialEntries = uniqNonEmpty([
    ...extraction.socialContextFacts,
    ...extraction.frequentLocations.map((location) => `常去地点：${location}`),
  ]).map((content) => ({
    memoryType: 'social_context' as const,
    content,
    metadata: { source: 'extract-preferences', category: 'social_context' },
    importance: 2,
  }));

  return [...preferenceEntries, ...identityEntries, ...socialEntries];
}

async function upsertUserMemory(
  userId: string,
  input: PersistentUserMemoryInput
): Promise<void> {
  const [existing] = await db
    .select({
      id: userMemories.id,
      importance: userMemories.importance,
      metadata: userMemories.metadata,
    })
    .from(userMemories)
    .where(and(
      eq(userMemories.userId, userId),
      eq(userMemories.memoryType, input.memoryType),
      eq(userMemories.content, input.content),
    ))
    .limit(1);

  if (existing) {
    await db
      .update(userMemories)
      .set({
        importance: Math.max(existing.importance ?? 0, input.importance ?? 0),
        metadata: {
          ...(typeof existing.metadata === 'object' && existing.metadata !== null ? existing.metadata : {}),
          ...(input.metadata ?? {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(userMemories.id, existing.id));
    return;
  }

  const embedding = await generateEmbedding(input.content, { textType: 'document' });
  await db.insert(userMemories).values({
    userId,
    memoryType: input.memoryType,
    content: input.content,
    embedding,
    metadata: input.metadata ?? {},
    importance: input.importance ?? 0,
  });
}

export async function persistExtractedUserMemories(
  userId: string,
  extraction: PreferenceExtraction
): Promise<void> {
  const inputs = toPersistentMemoryInputs(extraction);
  if (inputs.length === 0) {
    return;
  }

  await Promise.all(inputs.map((input) => upsertUserMemory(userId, input)));
}
