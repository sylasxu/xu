import { pgTable, uuid, varchar, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { geometry } from "drizzle-orm/pg-core";
import { users } from "./users";
import { activities } from "./activities";
import { activityTypeEnum, intentMatchOutcomeEnum, partnerScenarioTypeEnum } from "./enums";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * 意向匹配表 (v4.0 Smart Broker - 3表精简版)
 * 
 * 存储匹配成功的意向组，同时作为"隐形群组"载体
 * 优化：用 uuid[] 数组替代 intent_match_members 中间表
 */
export const intentMatches = pgTable("intent_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // 匹配信息
  activityType: activityTypeEnum("activity_type").notNull(),
  scenarioType: partnerScenarioTypeEnum("scenario_type").default("local_partner").notNull(),
  matchScore: integer("match_score").notNull(), // 0-100，基于 tag 重合度
  commonTags: jsonb("common_tags").$type<string[]>().notNull(), // 共同标签
  centerLocation: geometry("center_location", { type: "point", mode: "xy", srid: 4326 }).notNull(),
  centerLocationHint: varchar("center_location_hint", { length: 100 }).notNull(),
  destinationText: varchar("destination_text", { length: 120 }),
  timeText: varchar("time_text", { length: 80 }),
  
  // 临时召集人 (最早意向创建者)
  tempOrganizerId: uuid("temp_organizer_id").notNull().references(() => users.id),
  
  // 优化：直接用数组存储关联的 Intent IDs 和 User IDs，砍掉中间表
  intentIds: uuid("intent_ids").array().notNull(),
  userIds: uuid("user_ids").array().notNull(),
  
  // 关联正式活动 (确认后)
  activityId: uuid("activity_id").references(() => activities.id),
  
  // 状态
  outcome: intentMatchOutcomeEnum("outcome").default("pending").notNull(),
  confirmDeadline: timestamp("confirm_deadline").notNull(), // 6h 或当天 23:59
  
  // 时间戳
  matchedAt: timestamp("matched_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("intent_matches_outcome_idx").on(t.outcome),
  index("intent_matches_scenario_idx").on(t.scenarioType),
  index("intent_matches_organizer_idx").on(t.tempOrganizerId),
  index("intent_matches_deadline_idx").on(t.confirmDeadline),
]);

export const insertIntentMatchSchema = createInsertSchema(intentMatches);
export const selectIntentMatchSchema = createSelectSchema(intentMatches);

export type IntentMatch = typeof intentMatches.$inferSelect;
export type NewIntentMatch = typeof intentMatches.$inferInsert;
