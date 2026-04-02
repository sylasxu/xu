/**
 * Identity Reply - 身份相关问题识别
 *
 * 仅提供意图分类特征检测，不再负责生成回复。
 * 所有身份/记忆相关回复统一由 LLM 主链路通过 workingMemory 生成。
 */

const IDENTITY_MEMORY_PATTERNS = [
  /你知道我是谁吗/,
  /你记得我吗/,
  /你了解我吗/,
  /你对我有印象吗/,
  /^我是谁[？?]?$/,
] as const;

export function isIdentityMemoryQuestion(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) {
    return false;
  }

  return IDENTITY_MEMORY_PATTERNS.some((pattern) => pattern.test(normalized));
}
