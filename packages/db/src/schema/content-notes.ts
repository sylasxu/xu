import { pgTable, pgEnum, uuid, varchar, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

// ==========================================
// 自媒体内容运营 - 小红书笔记表
// ==========================================

export const contentTypeEnum = pgEnum("content_type", [
  "activity_recruit",   // 活动招募
  "buddy_story",        // 搭子故事
  "local_guide",        // 本地攻略
  "product_seed",       // 产品种草
]);

export const contentNotes = pgTable("content_notes", {
  id: uuid("id").primaryKey().defaultRandom(),

  // --- 生成参数 ---
  topic: varchar("topic", { length: 200 }).notNull(),
  contentType: contentTypeEnum("content_type").notNull(),
  batchId: uuid("batch_id").notNull(),  // 同一次批量生成共享

  // --- 笔记内容 ---
  title: varchar("title", { length: 60 }).notNull(),
  body: text("body").notNull(),
  hashtags: jsonb("hashtags").$type<string[]>().notNull(),
  coverImageHint: text("cover_image_hint"),

  // --- 效果数据（运营回填） ---
  views: integer("views"),
  likes: integer("likes"),
  collects: integer("collects"),
  comments: integer("comments"),
  newFollowers: integer("new_followers"),

  // --- 时间戳 ---
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("content_notes_batch_idx").on(t.batchId),
  index("content_notes_type_idx").on(t.contentType),
  index("content_notes_created_at_idx").on(t.createdAt),
]);

export const insertContentNoteSchema = createInsertSchema(contentNotes);
export const selectContentNoteSchema = createSelectSchema(contentNotes);
export type ContentNote = typeof contentNotes.$inferSelect;
export type NewContentNote = typeof contentNotes.$inferInsert;
