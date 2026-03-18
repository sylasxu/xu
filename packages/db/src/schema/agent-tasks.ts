import { pgTable, uuid, varchar, timestamp, index, jsonb, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";
import { users } from "./users";
import { activities } from "./activities";
import { conversations } from "./conversations";
import { partnerIntents } from "./partner-intents";
import { intentMatches } from "./intent-matches";
import {
  agentTaskStageEnum,
  agentTaskStatusEnum,
  agentTaskTypeEnum,
} from "./enums";

export interface AgentTaskSlotSummary {
  [key: string]: unknown;
}

export interface AgentTaskPendingAction {
  [key: string]: unknown;
}

export const agentTasks = pgTable("agent_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  taskType: agentTaskTypeEnum("task_type").notNull(),
  status: agentTaskStatusEnum("status").default("active").notNull(),
  currentStage: agentTaskStageEnum("current_stage").default("intent_captured").notNull(),
  goalText: text("goal_text").notNull(),
  entryConversationId: uuid("entry_conversation_id").references(() => conversations.id),
  latestConversationId: uuid("latest_conversation_id").references(() => conversations.id),
  activityId: uuid("activity_id").references(() => activities.id),
  partnerIntentId: uuid("partner_intent_id").references(() => partnerIntents.id),
  intentMatchId: uuid("intent_match_id").references(() => intentMatches.id),
  source: varchar("source", { length: 100 }),
  entry: varchar("entry", { length: 100 }),
  slotSummary: jsonb("slot_summary").$type<AgentTaskSlotSummary>(),
  pendingAction: jsonb("pending_action").$type<AgentTaskPendingAction>(),
  resultOutcome: varchar("result_outcome", { length: 50 }),
  resultSummary: text("result_summary"),
  lastUserMessageAt: timestamp("last_user_message_at"),
  completedAt: timestamp("completed_at"),
  expiredAt: timestamp("expired_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("agent_tasks_user_idx").on(t.userId),
  index("agent_tasks_status_idx").on(t.status),
  index("agent_tasks_type_status_idx").on(t.taskType, t.status),
  index("agent_tasks_activity_idx").on(t.activityId),
  index("agent_tasks_partner_intent_idx").on(t.partnerIntentId),
  index("agent_tasks_intent_match_idx").on(t.intentMatchId),
  index("agent_tasks_latest_conversation_idx").on(t.latestConversationId),
  index("agent_tasks_updated_idx").on(t.updatedAt),
]);

export const insertAgentTaskSchema = createInsertSchema(agentTasks);
export const selectAgentTaskSchema = createSelectSchema(agentTasks);

export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = typeof agentTasks.$inferInsert;
