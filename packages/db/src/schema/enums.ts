import { pgEnum } from "drizzle-orm/pg-core";

// ==========================================
// MVP 精简版枚举定义 (v3.3)
// ==========================================

// ==========================================
// 1. 📍 活动业务 (Activity Domain)
// ==========================================

// 活动类型 (保持不变，但移除 study)
export const activityTypeEnum = pgEnum("activity_type", [
  "food",
  "entertainment",
  "sports",
  "boardgame",
  "other"
]);

// 活动状态 (v3.2 新增 draft)
export const activityStatusEnum = pgEnum("activity_status", [
  "draft",      // AI 生成了，用户还没点确认
  "active",     // 用户确认了，正式发布 (地图可见)
  "completed",  // 已成局
  "cancelled"   // 已取消
]);

// ==========================================
// 2. 👥 参与者 (Participant Domain)
// ==========================================

// 参与者状态 (v5.5 扩展候补)
export const participantStatusEnum = pgEnum("participant_status", [
  "joined",    // 已加入
  "waitlist",  // 已候补
  "quit"       // 已退出
]);

// ==========================================
// 3. 💬 消息 (Chat Domain)
// ==========================================

// 注意：messageTypeEnum 已迁移到 activity_messages.ts
// 现在使用 activityMessageTypeEnum (本地定义，语义化命名)

// ==========================================
// 4. 🔔 通知 (Notification Domain)
// ==========================================

// 通知类型 (MVP 简化为 5 种)
export const notificationTypeEnum = pgEnum("notification_type", [
  "join",              // 有人报名（通知创建者）
  "quit",              // 有人退出
  "activity_start",    // 活动即将开始
  "completed",         // 活动成局
  "cancelled",         // 活动取消
  // v5.0 新增
  "new_participant",   // 有新人报名（通知所有已报名参与者）
  "post_activity",     // 活动结束后反馈推送
  "activity_reminder"  // 活动前 1 小时提醒
]);

// ==========================================
// 5. 🤝 搭子意向 (Partner Intent Domain)
// ==========================================

// 搭子意向状态
export const partnerIntentStatusEnum = pgEnum("partner_intent_status", [
  "active",     // 活跃中，等待匹配
  "matched",    // 已匹配成功
  "expired",    // 已过期 (24h)
  "cancelled"   // 用户取消
]);

export const partnerScenarioTypeEnum = pgEnum("partner_scenario_type", [
  "local_partner",
  "destination_companion",
  "fill_seat",
]);

// 匹配结果状态
export const intentMatchOutcomeEnum = pgEnum("intent_match_outcome", [
  "pending",    // 等待确认
  "confirmed",  // 已确认，转为活动
  "expired",    // 超时未确认
  "cancelled"   // 取消
]);

// ==========================================
// 5.5 🤖 Agent Task Runtime (v5.4)
// ==========================================

export const agentTaskTypeEnum = pgEnum("agent_task_type", [
  "join_activity",
  "find_partner",
  "create_activity"
]);

export const agentTaskStatusEnum = pgEnum("agent_task_status", [
  "active",
  "waiting_auth",
  "waiting_async_result",
  "completed",
  "cancelled",
  "expired"
]);

export const agentTaskStageEnum = pgEnum("agent_task_stage", [
  "intent_captured",
  "explore",
  "preference_collecting",
  "draft_collecting",
  "action_selected",
  "auth_gate",
  "draft_ready",
  "joined",
  "intent_posted",
  "awaiting_match",
  "match_ready",
  "activity_created",
  "published",
  "discussion",
  "post_activity",
  "done"
]);

export const agentTaskEventTypeEnum = pgEnum("agent_task_event_type", [
  "task_created",
  "context_updated",
  "action_selected",
  "auth_blocked",
  "auth_resumed",
  "stage_changed",
  "discussion_entered",
  "outcome_recorded",
  "task_completed"
]);

// ==========================================
// 6. 🔥 全局关键词 (Global Keywords Domain)
// ==========================================

// 关键词匹配类型
export const matchTypeEnum = pgEnum("match_type", [
  "exact",   // 完全匹配
  "prefix",  // 前缀匹配
  "fuzzy"    // 模糊匹配
]);

// 关键词响应类型 (复用现有 widget 类型)
export const keywordResponseTypeEnum = pgEnum("keyword_response_type", [
  "widget_explore",        // 探索附近活动
  "widget_draft",          // 草稿活动
  "widget_launcher",       // 快速发起
  "widget_action",         // 操作面板
  "widget_ask_preference", // 询问偏好
  "text"                   // 纯文本响应
]);
