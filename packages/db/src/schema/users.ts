import { pgTable, uuid, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * 用户表 (MVP 精简版)
 * 
 * 保留字段：id, wxOpenId, phoneNumber, nickname, avatarUrl,
 *          aiCreateQuotaToday, aiQuotaResetAt, createdAt, updatedAt
 * 
 * 移除字段：lastLoginIp, lastLoginAt, bio, gender, fulfillmentCount, 
 *          disputeCount, feedbackReceivedCount, membershipType, 
 *          membershipExpiresAt, aiSearchQuotaToday, lastLocation, 
 *          lastActiveAt, interestTags, isRegistered, isRealNameVerified, isBlocked
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // --- 核心认证 ---
  wxOpenId: varchar("wx_openid", { length: 128 }).notNull().unique(),
  phoneNumber: varchar("phone_number", { length: 20 }), // 延迟绑定
  
  // --- 基础资料 ---
  nickname: varchar("nickname", { length: 50 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  
  // --- AI 额度 (MVP 简化) ---
  aiCreateQuotaToday: integer("ai_create_quota_today").default(3).notNull(),
  aiQuotaResetAt: timestamp("ai_quota_reset_at"),
  
  // --- 系统 ---
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("users_wx_openid_idx").on(t.wxOpenId),
]);

// TypeBox Schemas
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
