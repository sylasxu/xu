import { pgTable, uuid, varchar, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";
import { users } from "./users";
import { activities } from "./activities";
import { conversations } from "./conversations";
import { notifications } from "./notifications";
import { agentTasks } from "./agent-tasks";
import {
  agentTaskEventTypeEnum,
  agentTaskStageEnum,
} from "./enums";

export interface AgentTaskEventPayload {
  [key: string]: unknown;
}

export const agentTaskEvents = pgTable("agent_task_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  eventType: agentTaskEventTypeEnum("event_type").notNull(),
  fromStage: agentTaskStageEnum("from_stage"),
  toStage: agentTaskStageEnum("to_stage"),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  activityId: uuid("activity_id").references(() => activities.id),
  notificationId: uuid("notification_id").references(() => notifications.id),
  source: varchar("source", { length: 100 }),
  payload: jsonb("payload").$type<AgentTaskEventPayload>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_task_events_task_idx").on(t.taskId),
  index("agent_task_events_user_idx").on(t.userId),
  index("agent_task_events_activity_idx").on(t.activityId),
  index("agent_task_events_created_idx").on(t.createdAt),
]);

export const insertAgentTaskEventSchema = createInsertSchema(agentTaskEvents);
export const selectAgentTaskEventSchema = createSelectSchema(agentTaskEvents);

export type AgentTaskEvent = typeof agentTaskEvents.$inferSelect;
export type NewAgentTaskEvent = typeof agentTaskEvents.$inferInsert;
