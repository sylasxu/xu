import { pgTable, uuid, varchar, integer, timestamp, boolean, text, index } from "drizzle-orm/pg-core";
import { aiRequests } from "./ai-requests";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * AI Tool 调用日志表 (v4.6)
 * 
 * 用于记录 AI Tool 的调用情况，支持性能分析和错误追踪
 */
export const aiToolCalls = pgTable("ai_tool_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  requestId: uuid("request_id").notNull().references(() => aiRequests.id, { onDelete: 'cascade' }),
  
  // --- Tool 信息 ---
  toolName: varchar("tool_name", { length: 100 }).notNull(),
  
  // --- 性能指标 ---
  durationMs: integer("duration_ms").notNull(),
  
  // --- 执行结果 ---
  success: boolean("success").notNull(),
  error: text("error"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ai_tool_calls_request_idx").on(t.requestId),
  index("ai_tool_calls_tool_name_idx").on(t.toolName),
  index("ai_tool_calls_success_idx").on(t.success),
]);

export const insertAiToolCallSchema = createInsertSchema(aiToolCalls);
export const selectAiToolCallSchema = createSelectSchema(aiToolCalls);

export type AiToolCall = typeof aiToolCalls.$inferSelect;
export type NewAiToolCall = typeof aiToolCalls.$inferInsert;
