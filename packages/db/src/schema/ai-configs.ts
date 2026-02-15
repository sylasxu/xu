import { pgTable, uuid, varchar, jsonb, integer, timestamp, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * AI 配置表
 *
 * 存储 AI 系统的可配置参数（意图分类规则、Few-shot 样例、模型路由等）
 * 支持版本管理和回滚
 */
export const aiConfigs = pgTable("ai_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 配置键，如 'intent.feature_rules', 'intent.few_shot_examples' */
  configKey: varchar("config_key", { length: 100 }).notNull().unique(),
  /** 配置值（JSONB） */
  configValue: jsonb("config_value").notNull(),
  /** 分类：intent | memory | model | processor */
  category: varchar("category", { length: 50 }).notNull(),
  /** 配置项描述 */
  description: text("description"),
  /** 版本号，每次更新自增 */
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** 更新人 */
  updatedBy: varchar("updated_by", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_configs_category_idx").on(t.category),
  index("ai_configs_config_key_idx").on(t.configKey),
]);

/**
 * AI 配置变更历史表
 *
 * 每次更新配置时，将旧版本复制到此表，支持回滚
 */
export const aiConfigHistory = pgTable("ai_config_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  configKey: varchar("config_key", { length: 100 }).notNull(),
  configValue: jsonb("config_value").notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  updatedBy: varchar("updated_by", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_config_history_key_idx").on(t.configKey),
  index("ai_config_history_key_version_idx").on(t.configKey, t.version),
]);

export const insertAiConfigSchema = createInsertSchema(aiConfigs);
export const selectAiConfigSchema = createSelectSchema(aiConfigs);
export const insertAiConfigHistorySchema = createInsertSchema(aiConfigHistory);
export const selectAiConfigHistorySchema = createSelectSchema(aiConfigHistory);

export type AiConfig = typeof aiConfigs.$inferSelect;
export type NewAiConfig = typeof aiConfigs.$inferInsert;
export type AiConfigHistoryRecord = typeof aiConfigHistory.$inferSelect;
