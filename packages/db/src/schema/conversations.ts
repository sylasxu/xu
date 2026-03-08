import { pgTable, uuid, jsonb, timestamp, index, pgEnum, text, integer, boolean } from "drizzle-orm/pg-core";
import { users } from "./users";
import { activities } from "./activities";
import { vector } from "./custom-types";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

/**
 * AI 对话系统 - 两层结构
 * 
 * conversations: 会话（一次完整的 agent 交互）
 * messages: 消息（会话中的每条消息）
 * 
 * 设计说明：
 * - 用户点"新对话"时创建新的 conversation
 * - 每条消息都关联到一个 conversation
 * - Admin 对话审计页按 conversation 展示
 */

// ==========================================
// 枚举定义
// ==========================================

// 对话角色枚举 (行业标准命名，使用 assistant 符合 OpenAI 标准)
export const conversationRoleEnum = pgEnum("conversation_role", [
  "user",       // 用户发送的消息
  "assistant"   // AI 回复的消息 (符合 OpenAI 标准)
]);

// 对话消息类型枚举
export const conversationMessageTypeEnum = pgEnum("conversation_message_type", [
  "text",                    // 普通文本
  "user_action",             // 结构化用户操作 (A2UI 风格)
  "widget_dashboard",        // 进场欢迎卡片
  "widget_launcher",         // 组局发射台
  "widget_action",           // 快捷操作按钮
  "widget_draft",            // 意图解析卡片
  "widget_share",            // 创建成功卡片
  "widget_explore",          // 探索卡片
  "widget_error",            // 错误提示卡片
  "widget_ask_preference"    // 多轮对话偏好询问卡片
]);

// v4.6: 会话评估状态枚举 (Admin Command Center)
export const evaluationStatusEnum = pgEnum("evaluation_status", [
  "unreviewed",  // 未评估（默认）
  "good",        // AI 表现良好
  "bad"          // Bad Case，需要优化
]);

// ==========================================
// conversations 表（会话）
// ==========================================

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),

  // 所属用户
  userId: uuid("user_id").notNull().references(() => users.id),

  // 会话标题（从第一条用户消息自动提取，可选）
  title: text("title"),

  // 消息数量（冗余字段，方便查询）
  messageCount: integer("message_count").default(0).notNull(),

  // 时间戳
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),

  // ==========================================
  // v4.6: Admin Command Center - 评估字段
  // ==========================================

  // 评估状态：unreviewed(默认) / good / bad
  evaluationStatus: evaluationStatusEnum("evaluation_status").default("unreviewed").notNull(),

  // 评估标签 (JSON 数组)
  // 可选值: ['wrong_intent', 'hallucination', 'tool_error', 'bad_tone', 'incomplete']
  evaluationTags: jsonb("evaluation_tags").$type<string[]>().default([]),

  // 人工备注
  evaluationNote: text("evaluation_note"),

  // 是否包含错误 (widget_error)，方便筛选
  hasError: boolean("has_error").default(false).notNull(),
}, (t) => [
  index("conversations_user_idx").on(t.userId),
  index("conversations_last_message_idx").on(t.lastMessageAt),
  // v4.6: 评估相关索引
  index("conversations_evaluation_status_idx").on(t.evaluationStatus),
  index("conversations_has_error_idx").on(t.hasError),
]);

// ==========================================
// conversation_messages 表（消息）
// ==========================================

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),

  // 所属会话
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: 'cascade' }),

  // 所属用户（冗余，方便查询）
  userId: uuid("user_id").notNull().references(() => users.id),

  // 角色：用户说的 or AI 回复的
  role: conversationRoleEnum("role").notNull(),

  // 消息类型：决定前端渲染哪种 Widget
  messageType: conversationMessageTypeEnum("message_type").notNull(),

  // 内容：JSONB 存储灵活的卡片数据
  content: jsonb("content").notNull(),

  // 关联：如果消息对应真实活动
  activityId: uuid("activity_id").references(() => activities.id),

  // v4.7 语义搜索：向量字段 (Qwen text-embedding-v4, 1536 维)
  embedding: vector('embedding', { dimensions: 1536 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("conversation_messages_conversation_idx").on(t.conversationId),
  index("conversation_messages_user_idx").on(t.userId),
  index("conversation_messages_created_idx").on(t.createdAt),
  index("conversation_messages_activity_idx").on(t.activityId),
]);

// ==========================================
// TypeBox Schemas
// ==========================================

export const insertConversationSchema = createInsertSchema(conversations);
export const selectConversationSchema = createSelectSchema(conversations);

export const insertMessageSchema = createInsertSchema(conversationMessages);
export const selectMessageSchema = createSelectSchema(conversationMessages);

// ==========================================
// TypeScript 类型
// ==========================================

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Message = typeof conversationMessages.$inferSelect;
export type NewMessage = typeof conversationMessages.$inferInsert;
