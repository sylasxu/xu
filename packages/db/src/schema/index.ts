// ==========================================
// Schema Exports - v4.5 Semantic Search
// ==========================================

// 0. Custom Types (pgvector support)
export * from "./custom-types";

// 1. Enums
export * from "./enums";

// 2. Core Tables
export * from "./users";
export * from "./activities";
export * from "./participants";

// 3. Chat System (v3.3 行业标准命名)
export * from "./activity_messages";  // 活动群聊
export * from "./conversations";      // AI 对话历史

// 4. Notification System
export * from "./notifications";

// 5. Report System (内容审核)
export * from "./reports";

// 6. Partner Intent System (v4.0 Smart Broker - 3表精简版)
export * from "./partner-intents";    // 搭子意向
export * from "./intent-matches";     // 意向匹配 (含 intentIds[], userIds[] 数组)
export * from "./match-messages";     // 匹配消息 (直接关联 matchId)

// 7. AI Ops (v4.6 对话质量监控 + 安全持久化)
export * from "./ai-conversation-metrics";
export * from "./ai-sensitive-words";
export * from "./ai-security-events";
export * from "./ai-requests";        // v4.8 AI 请求日志
export * from "./ai-tool-calls";      // v4.8 AI Tool 调用日志

// 8. Global Keywords System (v4.8 Digital Ascension)
export * from "./global_keywords";

// 9. AI Config System (v4.8 AI 参数配置)
export * from "./ai-configs";

// 10. AI Eval Samples (v4.6 评估结果持久化)
export * from "./ai-eval-samples";

// 10. Relations (must be last to avoid circular imports)
export * from "./relations";

// ==========================================
// v4.5 变更说明 (Semantic Search):
// - activities: 新增 embedding vector(1536) 列 (Qwen text-embedding-v4)
// - custom-types: 新增 pgvector 的 vector 类型支持
// - 迁移文件: 0009_add_embedding.sql
// ==========================================

// ==========================================
// v4.0 变更说明 (3表精简版):
// - partner_intents: 搭子意向 (保持不变)
// - intent_matches: 意向匹配 (新增 intentIds[], userIds[] 数组，移除 liteChatId)
// - match_messages: 匹配消息 (直接关联 matchId，替代 lite_chat_messages)
// 
// 删除的表:
// - intent_match_members (用 uuid[] 数组替代)
// - lite_chats (Match 本身就是群组)
// - lite_chat_messages (改为 match_messages)
// ==========================================
