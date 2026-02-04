import { pgTable, uuid, varchar, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { activities } from "./activities";
import { notificationTypeEnum } from "./enums";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * 通知表 (MVP 精简版)
 * 
 * MVP 通知类型：join, quit, activity_start, completed, cancelled
 * 
 * 简化设计：
 * - 移除 metadata jsonb，改为直接关联 activityId
 * - 移除 readAt，只保留 isRead 布尔值
 */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  userId: uuid("user_id").notNull().references(() => users.id),
  
  type: notificationTypeEnum("type").notNull(),
  
  title: varchar("title", { length: 100 }).notNull(),
  content: text("content"),
  
  // --- 关联 ---
  activityId: uuid("activity_id").references(() => activities.id),
  
  isRead: boolean("is_read").default(false).notNull(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("notifications_user_idx").on(t.userId),
  index("notifications_unread_idx").on(t.userId, t.isRead),
]);

export const insertNotificationSchema = createInsertSchema(notifications);
export const selectNotificationSchema = createSelectSchema(notifications);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
