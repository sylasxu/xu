# Requirements Document

## Introduction

v4.7 版本聚焦于三个核心变更：清理 Chat Tool Mode 相关内容、新增 AI 海报生成功能、新增活动讨论区实时通讯功能。本版本旨在简化通知策略、增强活动分享能力、并为活动参与者提供实时沟通渠道。

## Glossary

- **Activity_Discussion**: 活动讨论区，基于 WebSocket 的实时通讯功能，仅限活动参与者使用
- **AI_Poster_Generator**: AI 海报生成器，使用千问 VL 生成活动背景图，Puppeteer 合成最终海报
- **Poster**: 活动海报，包含背景图、活动信息、小程序码的分享图片
- **QRCode**: 小程序码，用于扫码进入活动详情页
- **WebSocket_Server**: Elysia 原生 WebSocket 服务，处理实时消息推送
- **Content_Security**: 内容安全检测，接入微信 msgSecCheck API 进行敏感词过滤
- **Offline_Notification**: 离线通知，用户不在线时通过客服消息或服务通知推送消息
- **Activity_Messages**: 活动消息表，存储活动讨论区的消息记录

## Requirements

### Requirement 1: 清理 Chat Tool Mode 相关内容

**User Story:** As a 开发者, I want to 移除 Chat Tool Mode 相关代码和文档, so that 代码库保持简洁，避免维护废弃功能。

#### Acceptance Criteria

1. THE PRD.md SHALL 移除 "1.4 微信聊天工具模式 (WeChat Chat Tool Mode)" 章节
2. THE TAD.md SHALL 移除 Chat Tool Mode 相关技术实现章节
3. THE activities 表 SHALL 移除 groupOpenId 和 dynamicMessageId 字段
4. THE participants 表 SHALL 移除 groupOpenId 字段
5. THE notifications 表 SHALL 移除 notificationMethod 字段和 notificationMethodEnum 枚举

### Requirement 2: AI 海报生成

**User Story:** As a 活动发起者, I want to 生成精美的活动海报, so that 我可以分享到朋友圈或微信群吸引更多人参与。

#### Acceptance Criteria

1. WHEN 用户请求生成海报 THEN THE AI_Poster_Generator SHALL 调用千问 VL 生成活动背景图
2. WHEN 背景图生成完成 THEN THE AI_Poster_Generator SHALL 使用 Puppeteer 合成最终海报
3. THE Poster SHALL 包含活动背景图、活动标题、时间、地点、小程序码
4. WHEN 生成海报 THEN THE System SHALL 调用微信 API 生成小程序码
5. THE AI_Poster_Generator SHALL 支持多种海报风格（简约、活力、文艺）
6. WHEN 海报生成成功 THEN THE System SHALL 返回海报图片 URL
7. IF 海报生成失败 THEN THE System SHALL 返回错误信息并提供重试选项
8. THE 海报生成 SHALL 在 10 秒内完成

### Requirement 3: 活动讨论区 - WebSocket 连接

**User Story:** As a 活动参与者, I want to 与其他参与者实时沟通, so that 我可以讨论活动细节、协调时间地点。

#### Acceptance Criteria

1. WHEN 用户进入活动讨论区 THEN THE System SHALL 建立 WebSocket 连接
2. THE WebSocket_Server SHALL 使用 Elysia 原生 WebSocket 实现
3. WHEN WebSocket 连接建立 THEN THE System SHALL 验证用户身份和活动参与状态
4. IF 用户未报名活动 THEN THE System SHALL 拒绝 WebSocket 连接并返回错误
5. WHEN WebSocket 连接断开 THEN THE System SHALL 清理连接资源
6. THE WebSocket_Server SHALL 支持心跳检测，超时 30 秒自动断开
7. WHEN 用户重新连接 THEN THE System SHALL 恢复连接并同步未读消息

### Requirement 4: 活动讨论区 - 消息发送与接收

**User Story:** As a 活动参与者, I want to 发送和接收实时消息, so that 我可以与其他参与者交流。

#### Acceptance Criteria

1. WHEN 用户发送消息 THEN THE System SHALL 将消息广播给活动内所有在线参与者
2. WHEN 用户发送消息 THEN THE System SHALL 将消息持久化到 Activity_Messages 表
3. THE Activity_Messages 表 SHALL 存储消息内容、发送者、活动 ID、时间戳
4. WHEN 用户进入讨论区 THEN THE System SHALL 加载最近 50 条历史消息
5. THE System SHALL 支持消息分页加载，每页 20 条
6. WHEN 消息发送成功 THEN THE System SHALL 返回消息 ID 和时间戳
7. IF 消息发送失败 THEN THE System SHALL 返回错误信息

### Requirement 5: 活动讨论区 - 内容安全

**User Story:** As a 平台运营者, I want to 过滤敏感内容, so that 讨论区保持健康的交流环境。

#### Acceptance Criteria

1. WHEN 用户发送消息 THEN THE Content_Security SHALL 调用微信 msgSecCheck API 检测内容
2. IF 消息包含敏感词 THEN THE System SHALL 拒绝发送并提示用户
3. THE Content_Security SHALL 支持异步检测，不阻塞消息发送流程
4. WHEN 检测到违规内容 THEN THE System SHALL 记录违规日志
5. THE System SHALL 支持用户举报功能
6. WHEN 用户举报消息 THEN THE System SHALL 创建举报记录并通知管理员

### Requirement 6: 活动讨论区 - 离线通知

**User Story:** As a 活动参与者, I want to 在离线时收到消息通知, so that 我不会错过重要信息。

#### Acceptance Criteria

1. WHEN 用户离线且有新消息 THEN THE System SHALL 通过客服消息推送通知（48h 内）
2. IF 客服消息发送失败 THEN THE System SHALL 使用服务通知作为兜底
3. THE Offline_Notification SHALL 包含消息摘要和活动名称
4. THE System SHALL 限制离线通知频率，每个活动每小时最多 3 条
5. WHEN 用户上线 THEN THE System SHALL 停止发送离线通知

### Requirement 7: 活动讨论区 - 生命周期管理

**User Story:** As a 平台运营者, I want to 管理讨论区生命周期, so that 资源得到合理利用。

#### Acceptance Criteria

1. WHEN 活动状态变为 completed 或 cancelled THEN THE Activity_Discussion SHALL 自动归档
2. WHEN 讨论区归档 THEN THE System SHALL 断开所有 WebSocket 连接
3. WHEN 讨论区归档 THEN THE System SHALL 保留历史消息但禁止新消息发送
4. THE System SHALL 支持管理员手动归档讨论区
5. WHEN 用户尝试进入已归档讨论区 THEN THE System SHALL 显示只读模式

### Requirement 8: 小程序讨论区 UI

**User Story:** As a 活动参与者, I want to 在小程序中使用讨论区, so that 我可以方便地与其他参与者交流。

#### Acceptance Criteria

1. THE 小程序 SHALL 提供讨论区入口，位于活动详情页
2. WHEN 用户进入讨论区 THEN THE 小程序 SHALL 使用 wx.connectSocket 建立连接
3. THE 讨论区 UI SHALL 显示消息列表、输入框、发送按钮
4. THE 消息列表 SHALL 显示发送者头像、昵称、消息内容、时间
5. WHEN 收到新消息 THEN THE 小程序 SHALL 自动滚动到最新消息
6. THE 小程序 SHALL 显示在线人数
7. WHEN 网络断开 THEN THE 小程序 SHALL 显示重连提示

### Requirement 9: 更新通知策略

**User Story:** As a 开发者, I want to 简化通知策略, so that 代码更易维护。

#### Acceptance Criteria

1. THE System SHALL 使用服务通知作为主要通知方式
2. THE System SHALL 使用客服消息作为讨论区离线通知方式
3. THE notifications 表 SHALL 移除 notificationMethod 字段
4. THE PRD.md SHALL 更新通知策略章节，移除混合通知策略

### Requirement 10: 更新 PRD/TAD 文档

**User Story:** As a 开发者, I want to 更新项目文档, so that 文档与代码保持一致。

#### Acceptance Criteria

1. THE PRD.md SHALL 新增 "AI 海报生成" 章节
2. THE PRD.md SHALL 新增 "活动讨论区" 章节
3. THE PRD.md SHALL 新增 "合规性" 章节，说明类目选择、资质要求
4. THE TAD.md SHALL 新增 "AI 海报技术实现" 章节
5. THE TAD.md SHALL 新增 "WebSocket 架构" 章节
6. THE TAD.md SHALL 新增 "内容安全集成" 章节
7. THE PRD.md 和 TAD.md SHALL 移除所有 Chat Tool Mode 相关内容

### Requirement 11: 合规性要求

**User Story:** As a 平台运营者, I want to 确保功能符合微信小程序规范, so that 小程序不会被下架。

#### Acceptance Criteria

1. THE 活动讨论区 SHALL 定位为"活动讨论"而非"聊天室"
2. THE 小程序类目 SHALL 选择"社区/论坛"
3. THE System SHALL 只允许已报名用户参与讨论
4. THE System SHALL 在活动结束后自动归档讨论区
5. THE System SHALL 接入微信内容安全 API
6. THE System SHALL 提供用户举报机制
