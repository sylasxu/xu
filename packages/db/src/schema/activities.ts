import { pgTable, uuid, varchar, text, timestamp, integer, index, jsonb } from "drizzle-orm/pg-core";
import { geometry } from "drizzle-orm/pg-core";
import { users } from "./users";
import { activityTypeEnum, activityStatusEnum } from "./enums";
import { vector } from "./custom-types";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * v5.0: 活动主题配置类型
 * 存储 React Bits Background Studio 导出的动态背景参数
 */
export interface ThemeConfig {
  background: {
    component: 'Aurora' | 'Ballpit' | 'Particles' | 'Threads' | 'Gradient' | 'Squares';
    config: Record<string, unknown>;
  };
  textEffect?: 'split' | 'blur' | 'gradient' | 'shiny';
  colorScheme?: {
    primary: string;
    secondary: string;
    text: string;
  };
}

/**
 * 活动表 (MVP 精简版)
 * 
 * 保留字段：id, creatorId, title, description, location, locationName, 
 *          address, locationHint (改为 notNull), startAt, type, 
 *          maxParticipants, currentParticipants, status, createdAt, updatedAt
 * 
 * 移除字段：images, endAt, feeType, estimatedCost, joinMode, riskScore, 
 *          riskLevel, tags, genderRequirement, minReliabilityRate, 
 *          isConfirmed, confirmedAt, isLocationBlurred, isBoosted, 
 *          boostExpiresAt, boostCount, isPinPlus, pinPlusExpiresAt, 
 *          isGhost, ghostAnchorType, ghostSuggestedType, chatStatus, chatArchivedAt
 * 
 * 注意：isArchived 在 API 层动态计算 (now > startAt + 24h)，不存储
 */
export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),

  creatorId: uuid("creator_id").notNull().references(() => users.id),

  // --- 基础信息 ---
  title: varchar("title", { length: 100 }).notNull(),
  description: text("description"),

  // --- 位置 (保留 PostGIS) ---
  location: geometry("location", { type: "point", mode: "xy", srid: 4326 }).notNull(),
  locationName: varchar("location_name", { length: 100 }).notNull(),
  address: varchar("address", { length: 255 }),
  locationHint: varchar("location_hint", { length: 100 }).notNull(), // 重庆地形必填

  // --- 时间 ---
  startAt: timestamp("start_at").notNull(),

  // --- 活动属性 ---
  type: activityTypeEnum("type").notNull(),
  maxParticipants: integer("max_participants").default(4).notNull(),
  currentParticipants: integer("current_participants").default(1).notNull(),

  // --- 状态 (v3.3 默认 draft，符合 AI 解析 → 用户确认的工作流) ---
  status: activityStatusEnum("status").default("draft").notNull(),

  // --- v5.0 主题系统 ---
  theme: varchar("theme", { length: 20 }).default("auto").notNull(),
  themeConfig: jsonb("theme_config").$type<ThemeConfig>(),

  // --- v4.5 语义搜索：向量字段 (Qwen text-embedding-v4, 1536 维) ---
  embedding: vector('embedding', { dimensions: 1536 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("activities_location_idx").using("gist", t.location),
  index("activities_start_at_idx").on(t.startAt),
  index("activities_status_idx").on(t.status),
  index("activities_type_idx").on(t.type),
  index("activities_creator_idx").on(t.creatorId),
  // v4.5: HNSW 索引用于向量相似度搜索
  // 注意：HNSW 索引需要在 SQL 迁移中手动创建，因为 Drizzle 不支持 HNSW 索引语法
  // 索引已在 0009_add_embedding.sql 中创建
]);

export const insertActivitySchema = createInsertSchema(activities);
export const selectActivitySchema = createSelectSchema(activities);

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
