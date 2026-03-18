import { relations } from "drizzle-orm";
import { users } from "./users";
import { activities } from "./activities";
import { participants } from "./participants";
import { notifications } from "./notifications";
import { activityMessages } from "./activity_messages";
import { conversations, conversationMessages } from "./conversations";
import { agentTasks } from "./agent-tasks";
import { agentTaskEvents } from "./agent-task-events";
import { reports } from "./reports";
import { partnerIntents } from "./partner-intents";
import { intentMatches } from "./intent-matches";
import { matchMessages } from "./match-messages";

// ==========================================
// User Relations
// ==========================================
export const usersRelations = relations(users, ({ many }) => ({
  activitiesCreated: many(activities),
  participations: many(participants),
  notifications: many(notifications),
  activityMessages: many(activityMessages),
  conversations: many(conversations),
  conversationMessages: many(conversationMessages),
  agentTasks: many(agentTasks),
  agentTaskEvents: many(agentTaskEvents),
  reportsSubmitted: many(reports, { relationName: "reporter" }),
  reportsResolved: many(reports, { relationName: "resolver" }),
  // v4.0 Partner Intent
  partnerIntents: many(partnerIntents),
  organizedMatches: many(intentMatches),
  matchMessages: many(matchMessages),
}));

// ==========================================
// Activity Relations
// ==========================================
export const activitiesRelations = relations(activities, ({ one, many }) => ({
  creator: one(users, {
    fields: [activities.creatorId],
    references: [users.id],
  }),
  participants: many(participants),
  activityMessages: many(activityMessages),
  notifications: many(notifications),
  conversationMessages: many(conversationMessages),
  agentTasks: many(agentTasks),
  agentTaskEvents: many(agentTaskEvents),
}));

// ==========================================
// Participant Relations
// ==========================================
export const participantsRelations = relations(participants, ({ one }) => ({
  user: one(users, {
    fields: [participants.userId],
    references: [users.id],
  }),
  activity: one(activities, {
    fields: [participants.activityId],
    references: [activities.id],
  }),
}));

// ==========================================
// Notification Relations
// ==========================================
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  activity: one(activities, {
    fields: [notifications.activityId],
    references: [activities.id],
  }),
  task: one(agentTasks, {
    fields: [notifications.taskId],
    references: [agentTasks.id],
  }),
}));

// ==========================================
// Agent Task Relations
// ==========================================
export const agentTasksRelations = relations(agentTasks, ({ one, many }) => ({
  user: one(users, {
    fields: [agentTasks.userId],
    references: [users.id],
  }),
  activity: one(activities, {
    fields: [agentTasks.activityId],
    references: [activities.id],
  }),
  partnerIntent: one(partnerIntents, {
    fields: [agentTasks.partnerIntentId],
    references: [partnerIntents.id],
  }),
  intentMatch: one(intentMatches, {
    fields: [agentTasks.intentMatchId],
    references: [intentMatches.id],
  }),
  entryConversation: one(conversations, {
    fields: [agentTasks.entryConversationId],
    references: [conversations.id],
    relationName: "agent_task_entry_conversation",
  }),
  latestConversation: one(conversations, {
    fields: [agentTasks.latestConversationId],
    references: [conversations.id],
    relationName: "agent_task_latest_conversation",
  }),
  conversationMessages: many(conversationMessages),
  notifications: many(notifications),
  events: many(agentTaskEvents),
}));

// ==========================================
// Agent Task Event Relations
// ==========================================
export const agentTaskEventsRelations = relations(agentTaskEvents, ({ one }) => ({
  task: one(agentTasks, {
    fields: [agentTaskEvents.taskId],
    references: [agentTasks.id],
  }),
  user: one(users, {
    fields: [agentTaskEvents.userId],
    references: [users.id],
  }),
  activity: one(activities, {
    fields: [agentTaskEvents.activityId],
    references: [activities.id],
  }),
  conversation: one(conversations, {
    fields: [agentTaskEvents.conversationId],
    references: [conversations.id],
  }),
  notification: one(notifications, {
    fields: [agentTaskEvents.notificationId],
    references: [notifications.id],
  }),
}));

// ==========================================
// Activity Message Relations
// ==========================================
export const activityMessagesRelations = relations(activityMessages, ({ one }) => ({
  activity: one(activities, {
    fields: [activityMessages.activityId],
    references: [activities.id],
  }),
  sender: one(users, {
    fields: [activityMessages.senderId],
    references: [users.id],
  }),
}));

// ==========================================
// Conversation Relations
// ==========================================
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(conversationMessages),
  entryAgentTasks: many(agentTasks, {
    relationName: "agent_task_entry_conversation",
  }),
  latestAgentTasks: many(agentTasks, {
    relationName: "agent_task_latest_conversation",
  }),
}));

// ==========================================
// ConversationMessage Relations
// ==========================================
export const conversationMessagesRelations = relations(conversationMessages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationMessages.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [conversationMessages.userId],
    references: [users.id],
  }),
  activity: one(activities, {
    fields: [conversationMessages.activityId],
    references: [activities.id],
  }),
  task: one(agentTasks, {
    fields: [conversationMessages.taskId],
    references: [agentTasks.id],
  }),
}));

// ==========================================
// Report Relations
// ==========================================
export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, {
    fields: [reports.reporterId],
    references: [users.id],
    relationName: "reporter",
  }),
  resolver: one(users, {
    fields: [reports.resolvedBy],
    references: [users.id],
    relationName: "resolver",
  }),
}));

// ==========================================
// Partner Intent Relations (v4.0 Smart Broker)
// ==========================================
export const partnerIntentsRelations = relations(partnerIntents, ({ one }) => ({
  user: one(users, {
    fields: [partnerIntents.userId],
    references: [users.id],
  }),
  agentTask: one(agentTasks, {
    fields: [partnerIntents.id],
    references: [agentTasks.partnerIntentId],
  }),
}));

// ==========================================
// Intent Match Relations (3表精简版)
// ==========================================
export const intentMatchesRelations = relations(intentMatches, ({ one, many }) => ({
  tempOrganizer: one(users, {
    fields: [intentMatches.tempOrganizerId],
    references: [users.id],
  }),
  activity: one(activities, {
    fields: [intentMatches.activityId],
    references: [activities.id],
  }),
  agentTasks: many(agentTasks),
  messages: many(matchMessages),
}));

// ==========================================
// Match Message Relations
// ==========================================
export const matchMessagesRelations = relations(matchMessages, ({ one }) => ({
  match: one(intentMatches, {
    fields: [matchMessages.matchId],
    references: [intentMatches.id],
  }),
  sender: one(users, {
    fields: [matchMessages.senderId],
    references: [users.id],
  }),
}));
