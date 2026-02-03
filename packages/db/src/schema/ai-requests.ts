import { pgTable, uuid, varchar, integer, timestamp, jsonb, text, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * AI 请求日志表 (v4.6)
 * 
 * 用于记录所有 AI 请求的执行情况，支持 AI Playground 流程图可视化
 * 
 * v4.8 新增字段：
 * - processorLog: Processor 执行日志（用于流程图可视化）
 * - p0MatchKeyword: P0 层匹配的关键词 ID（用于热词分析）
 */
export const aiRequests = pgTable("ai_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  userId: uuid("user_id").references(() => users.id),
  
  // --- 模型信息 ---
  modelId: varchar("model_id", { length: 100 }).notNull(),
  
  // --- Token 用量 ---
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  
  // --- 性能指标 ---
  latencyMs: integer("latency_ms").notNull(),
  
  // --- v4.8 Processor 执行日志 (用于 AI Playground 流程图) ---
  processorLog: jsonb("processor_log").$type<ProcessorLogEntry[]>(),
  
  // --- v4.8 P0 层匹配的关键词 ID (用于热词分析) ---
  p0MatchKeyword: uuid("p0_match_keyword"),
  
  // --- 请求内容 (可选，用于调试) ---
  input: text("input"),
  output: text("output"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ai_requests_user_idx").on(t.userId),
  index("ai_requests_model_idx").on(t.modelId),
  index("ai_requests_created_at_idx").on(t.createdAt),
  index("ai_requests_p0_keyword_idx").on(t.p0MatchKeyword),
]);

// Processor 执行日志条目类型
export interface ProcessorLogEntry {
  processorName: string;
  executionTime: number;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

export const insertAiRequestSchema = createInsertSchema(aiRequests);
export const selectAiRequestSchema = createSelectSchema(aiRequests);

export type AiRequest = typeof aiRequests.$inferSelect;
export type NewAiRequest = typeof aiRequests.$inferInsert;
