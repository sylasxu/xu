// ==========================================
// Schema Exports
// 以当前主流程与内部支撑真源为准
// ==========================================

// 0. Custom Types (pgvector support)
export * from "./custom-types";

// 1. Enums
export * from "./enums";

// 2. Core Business Tables
export * from "./users";
export * from "./activities";
export * from "./participants";

// 3. Chat System (v3.3 行业标准命名)
export * from "./activity_messages";  // 活动群聊
export * from "./conversations";      // AI 对话历史
export * from "./user-memories";      // 长期用户记忆

// 4. Notification System
export * from "./notifications";

// 4.5 Agent Task Runtime
export * from "./agent-tasks";
export * from "./agent-task-events";

// 5. Report System (内容审核)
export * from "./reports";

// 6. Partner Intent System
export * from "./partner-intents";    // 搭子意向（含 local_partner / destination_companion / fill_seat）
export * from "./intent-matches";     // 意向匹配结果
export * from "./match-messages";     // 匹配消息

// 7. AI Internal Support (安全持久化 + 请求日志)
export * from "./ai-sensitive-words";
export * from "./ai-security-events";
export * from "./ai-requests";
export * from "./ai-tool-calls";

// 8. Global Keywords System
export * from "./global_keywords";

// 9. AI Config System
export * from "./ai-configs";

// 10. Content Operations (自媒体内容运营)
export * from "./content-notes";

// 11. Relations (must be last to avoid circular imports)
export * from "./relations";

// 说明：
// - activities / conversation_messages 仍保留向量字段，用于语义检索
// - partner_intents / intent_matches 已跟上新的搭子语义字段
// - 已删除的过时 AI 观测表不再从这里导出
