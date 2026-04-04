import { pgTable, uuid, text, timestamp, index, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { activities } from "./activities";
import { users } from "./users";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * 活动群聊消息表 (v3.3 语义化命名)
 * 
 * 命名说明：
 * - 表名 activity_messages 明确表达"活动内的消息"
 * - 枚举 activityMessageTypeEnum 避免与通用 message_type 混淆
 * - 字段 messageType 比 type 更明确
 * 
 * 为了区分"两个聊天"场景：
 * - Conversations: 用户 vs AI (独角戏，存 conversations)
 * - Activity Messages: 用户 vs 用户 (活动群聊，存 activity_messages)
 * 
 * 设计说明：
 * - senderId 可为空：系统消息（如"张三退出了活动"）不需要 sender
 * - 前端渲染时，senderId 为空显示"系统通知"
 */

// 活动消息类型枚举 (语义化命名，本地定义)
export const activityMessageTypeEnum = pgEnum("activity_message_type", [
  "text",    // 文本消息
  "system"   // 系统消息
]);

export const activityMessages = pgTable("activity_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  activityId: uuid("activity_id").notNull().references(() => activities.id),
  senderId: uuid("sender_id").references(() => users.id), // 可为空：系统消息无 sender
  parentId: uuid("parent_id").references((): AnyPgColumn => activityMessages.id, { onDelete: "set null" }),
  
  // 消息类型 (使用本地定义的枚举)
  messageType: activityMessageTypeEnum("message_type").default("text").notNull(),
  content: text("content").notNull(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("activity_messages_activity_idx").on(t.activityId),
  index("activity_messages_parent_idx").on(t.parentId),
  index("activity_messages_created_idx").on(t.createdAt),
]);

// TypeBox Schemas
export const insertActivityMessageSchema = createInsertSchema(activityMessages);
export const selectActivityMessageSchema = createSelectSchema(activityMessages);

// TypeScript 类型
export type ActivityMessage = typeof activityMessages.$inferSelect;
export type NewActivityMessage = typeof activityMessages.$inferInsert;
