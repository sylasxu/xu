import { pgTable, uuid, varchar, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { geometry } from "drizzle-orm/pg-core";
import { users } from "./users";
import { activityTypeEnum, partnerIntentStatusEnum, partnerScenarioTypeEnum } from "./enums";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * 搭子意向表 (v4.0 Smart Broker)
 * 
 * 存储用户的找搭子意向，经过 Agent 追问澄清后入库
 * metaData 包含 Rich Intent：tags, sportType, poiPreference, budgetType, rawInput
 */

// Rich Intent 元数据类型
export interface PartnerIntentMetaData {
  tags: string[];              // ["AA", "NoAlcohol", "Quiet", "GirlFriendly"]
  sportType?: "badminton" | "basketball" | "running" | "tennis" | "swimming" | "cycling";
  poiPreference?: string;      // "朱光玉" (具体店铺)
  budgetType?: "AA" | "Treat" | "Free";
  rawInput: string;            // 原始用户输入
}

export const partnerIntents = pgTable("partner_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  
  // 基础信息
  activityType: activityTypeEnum("activity_type").notNull(),
  scenarioType: partnerScenarioTypeEnum("scenario_type").default("local_partner").notNull(),
  locationHint: varchar("location_hint", { length: 100 }).notNull(),
  destinationText: varchar("destination_text", { length: 120 }),
  location: geometry("location", { type: "point", mode: "xy", srid: 4326 }).notNull(),
  timePreference: varchar("time_preference", { length: 50 }),
  timeText: varchar("time_text", { length: 80 }),
  description: varchar("description", { length: 240 }),
  
  // Rich Intent - Agent 追问后提取的结构化偏好
  metaData: jsonb("meta_data").$type<PartnerIntentMetaData>().notNull(),
  
  // 状态
  status: partnerIntentStatusEnum("status").default("active").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  
  // 时间戳
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("partner_intents_user_idx").on(t.userId),
  index("partner_intents_status_idx").on(t.status),
  index("partner_intents_type_idx").on(t.activityType),
  index("partner_intents_scenario_idx").on(t.scenarioType),
  index("partner_intents_location_idx").using("gist", t.location),
  index("partner_intents_expires_idx").on(t.expiresAt),
]);

export const insertPartnerIntentSchema = createInsertSchema(partnerIntents);
export const selectPartnerIntentSchema = createSelectSchema(partnerIntents);

export type PartnerIntent = typeof partnerIntents.$inferSelect;
export type NewPartnerIntent = typeof partnerIntents.$inferInsert;
