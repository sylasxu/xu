import { pgTable, uuid, text, timestamp, index, jsonb, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";
import { users } from "./users";
import { conversationMessages } from "./conversations";
import { vector } from "./custom-types";

export const userMemoryTypeEnum = pgEnum("user_memory_type", [
  "profile_fact",
  "preference",
  "social_context",
  "activity_outcome",
  "summary",
]);

export interface UserMemoryMetadata {
  [key: string]: unknown;
}

export const userMemories = pgTable("user_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceMessageId: uuid("source_message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  memoryType: userMemoryTypeEnum("memory_type").default("profile_fact").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<UserMemoryMetadata>().default({}).notNull(),
  importance: integer("importance").default(0).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("user_memories_user_idx").on(t.userId),
  index("user_memories_type_idx").on(t.memoryType),
  index("user_memories_source_message_idx").on(t.sourceMessageId),
  index("user_memories_expires_idx").on(t.expiresAt),
  index("user_memories_created_idx").on(t.createdAt),
]);

export const insertUserMemorySchema = createInsertSchema(userMemories);
export const selectUserMemorySchema = createSelectSchema(userMemories);

export type UserMemory = typeof userMemories.$inferSelect;
export type NewUserMemory = typeof userMemories.$inferInsert;
