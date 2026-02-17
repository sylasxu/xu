import { pgTable, uuid, varchar, text, real, boolean, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * AI 评估样本表 (v4.6)
 * 
 * 用于持久化评估运行结果，追踪 AI 质量变化趋势
 */
export const aiEvalSamples = pgTable("ai_eval_samples", {
  id: uuid("id").primaryKey().defaultRandom(),

  // --- 运行信息 ---
  runId: varchar("run_id", { length: 100 }).notNull(),
  datasetName: varchar("dataset_name", { length: 100 }).notNull(),
  sampleId: varchar("sample_id", { length: 100 }).notNull(),

  // --- 输入输出 ---
  input: text("input").notNull(),
  expectedIntent: varchar("expected_intent", { length: 50 }),
  actualIntent: varchar("actual_intent", { length: 50 }),
  actualOutput: text("actual_output"),

  // --- 评分 ---
  scores: jsonb("scores").$type<Record<string, number>>(),
  totalScore: real("total_score"),
  passed: boolean("passed").default(false),

  // --- 性能 ---
  durationMs: integer("duration_ms"),
  error: text("error"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ai_eval_samples_run_id_idx").on(t.runId),
  index("ai_eval_samples_created_at_idx").on(t.createdAt),
]);

export const insertAiEvalSampleSchema = createInsertSchema(aiEvalSamples);
export const selectAiEvalSampleSchema = createSelectSchema(aiEvalSamples);

export type AiEvalSample = typeof aiEvalSamples.$inferSelect;
export type NewAiEvalSample = typeof aiEvalSamples.$inferInsert;
