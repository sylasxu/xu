import { pgTable, uuid, timestamp, index, unique } from "drizzle-orm/pg-core";
import { users } from "./users";
import { activities } from "./activities";
import { participantStatusEnum } from "./enums";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * 参与者表 (MVP 精简版)
 * 
 * 保留字段：id, activityId, userId, status, joinedAt, updatedAt
 * 
 * 移除字段：applicationMsg, isFastPass, confirmedAt, isDisputed, 
 *          disputedAt, disputeExpiresAt
 */
export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  activityId: uuid("activity_id").notNull().references(() => activities.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  
  // --- 状态 (MVP 简化) ---
  status: participantStatusEnum("status").default("joined").notNull(),
  
  joinedAt: timestamp("joined_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  unique("unique_participant").on(t.activityId, t.userId),
  index("participant_user_idx").on(t.userId),
  index("participant_activity_idx").on(t.activityId),
  index("participant_status_idx").on(t.status),
]);

export const insertParticipantSchema = createInsertSchema(participants);
export const selectParticipantSchema = createSelectSchema(participants);

export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
