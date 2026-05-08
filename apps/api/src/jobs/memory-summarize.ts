/**
 * Memory Summarize Job
 *
 * 每日凌晨汇总用户对话，生成偏好摘要写入 user_memories。
 * - 读取过去 24 小时的 user 消息
 * - 按 userId 分组，调用轻量 LLM 生成摘要
 * - 以 memoryType='summary' 写入 user_memories
 */

import { db, conversationMessages, userMemories, eq, and, gte, sql } from '@xu/db';
import { generateText } from 'ai';
import { resolveChatModelSelection } from '../modules/ai/models/router';
import { shouldOmitTemperatureForModelId } from '../modules/ai/models/router';
import { jobLogger } from '../lib/logger';

const SUMMARY_PROMPT = `以下是一位用户在最近对话中的消息，请总结用户的偏好、习惯和意图：

{{messages}}

请用 2-4 句话总结，只输出总结内容，不要解释。`;

function buildSummaryPrompt(messages: string[]): string {
  const lines = messages.map((m, i) => `${i + 1}. ${m}`);
  return SUMMARY_PROMPT.replace('{{messages}}', lines.join('\n'));
}

export async function summarizeUserMemories(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentMessages = await db
    .select({
      userId: conversationMessages.userId,
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(and(
      eq(conversationMessages.role, 'user'),
      gte(conversationMessages.createdAt, since),
      sql`${conversationMessages.content} IS NOT NULL`,
    ))
    .orderBy(conversationMessages.createdAt);

  // 按 userId 分组
  const grouped = new Map<string, string[]>();
  for (const msg of recentMessages) {
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (!text.trim()) continue;
    const list = grouped.get(msg.userId) || [];
    list.push(text.trim());
    grouped.set(msg.userId, list);
  }

  if (grouped.size === 0) {
    jobLogger.jobStats('用户记忆汇总', 0, 0);
    return;
  }

  let successCount = 0;
  let failCount = 0;

  const { model, modelId } = await resolveChatModelSelection({ routeKey: 'chat' });

  for (const [userId, messages] of grouped) {
    if (messages.length === 0) continue;

    try {
      const prompt = buildSummaryPrompt(messages.slice(-10)); // 最多取最近 10 条

      const { text } = await generateText({
        model,
        system: '你是对话摘要助手，只输出简洁的偏好摘要。',
        prompt,
        ...(shouldOmitTemperatureForModelId(modelId) ? {} : { temperature: 0.3 }),
        maxOutputTokens: 200,
      });

      const summary = text.trim();
      if (!summary) {
        failCount++;
        continue;
      }

      await db.insert(userMemories).values({
        userId,
        memoryType: 'summary',
        content: summary,
        importance: 1,
        metadata: { source: 'daily_summary', messageCount: messages.length },
      });

      successCount++;
    } catch (error) {
      jobLogger.jobError('用户记忆汇总', 0, error);
      failCount++;
    }
  }

  jobLogger.jobStats('用户记忆汇总', successCount, failCount);
}
