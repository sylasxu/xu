# 需求文档：自媒体内容运营中心

## 简介

自媒体内容运营中心是 JuChang 管理后台的 AI 内容生成工具，专注于小红书平台的引流内容批量生产。核心目标：帮助运营人员每天高效产出多篇小红书笔记，为搭子群引流拉人。系统充分考虑小红书平台规则（标题字数、正文结构、话题标签等），通过 AI 生成符合平台规范的完整笔记内容。所有生成内容入库持久化，运营人员可回填发布后的效果数据（浏览量、点赞、收藏等），系统基于效果数据进行分析并利用 AI 优化后续内容生成策略。基于现有增长模块（growth）升级，复用已有 AI 基础设施。

## 术语表

- **Content_Generator**: AI 内容生成服务，接收主题参数，调用 LLM 生成符合小红书规范的完整笔记内容
- **Content_Library**: 内容库，存储所有已生成的笔记记录及其效果数据，支持查询、复用和分析
- **Note**: 小红书笔记，包含标题、正文、话题标签、图片描述提示等完整发布所需内容
- **Prompt_Template**: 提示词模板，通过 getConfigValue 系统管理，支持热更新
- **Content_Type**: 内容类型枚举，包括活动招募（拉人）、搭子故事（种草）、本地攻略（引流）、产品种草（品牌）
- **Operator**: 运营人员，使用管理后台批量生成和管理小红书笔记内容的用户
- **Trend_Insight**: 热门洞察数据，来自现有 getTrendInsights 服务的用户高频词
- **Performance_Data**: 效果数据，运营人员手动回填的笔记发布后表现数据（浏览量、点赞数、收藏数、评论数、涨粉数）
- **Content_Analyzer**: 内容效果分析服务，基于 Performance_Data 统计分析内容表现，为 AI 优化提供数据支撑

## 需求

### 需求 1：小红书笔记内容生成

**用户故事：** 作为运营人员，我希望输入主题后 AI 生成一篇完整的小红书笔记内容，以便我直接复制到小红书发布。

#### 验收标准

1. WHEN Operator 提交主题关键词和内容类型, THE Content_Generator SHALL 调用 LLM 生成一篇完整的小红书 Note，包含标题、正文、话题标签列表和封面图片描述提示
2. WHEN Content_Generator 生成标题时, THE Content_Generator SHALL 确保标题不超过 20 个字符，包含吸引点击的 emoji 和关键词
3. WHEN Content_Generator 生成正文时, THE Content_Generator SHALL 生成 300-800 字的正文，采用分段结构（开头 hook + 正文内容 + 引导互动结尾），包含适量 emoji 排版
4. WHEN Content_Generator 生成话题标签时, THE Content_Generator SHALL 生成 5-10 个相关话题标签，混合热门大标签和精准小标签
5. WHEN Content_Generator 生成内容时, THE Content_Generator SHALL 使用"搭子观察员"第三人称叙事视角，保持接地气、温暖、真实分享的调性，避免营销感和广告腔
6. WHEN Content_Generator 生成内容时, THE Content_Generator SHALL 在正文末尾自然植入引导语（如"评论区聊聊"、"想加群的扣 1"），引导用户互动和进群
7. WHEN 内容生成完成, THE Content_Library SHALL 自动将生成结果持久化到数据库，记录主题、内容类型、各字段内容和生成时间
8. IF Content_Generator 调用 LLM 失败, THEN THE Content_Generator SHALL 返回包含错误原因的错误响应，不保存失败记录到 Content_Library

### 需求 2：批量生成支持

**用户故事：** 作为运营人员，我希望一次生成多篇不同角度的笔记，以便一天内发布多篇内容覆盖不同受众。

#### 验收标准

1. WHEN Operator 指定生成数量（1-5 篇）, THE Content_Generator SHALL 为同一主题生成指定数量的差异化笔记，每篇采用不同的切入角度和表达方式
2. WHEN 批量生成多篇笔记时, THE Content_Generator SHALL 确保各篇笔记之间标题和正文内容有明显差异，避免重复和雷同
3. WHEN 批量生成完成, THE Content_Library SHALL 将所有生成的笔记作为一组记录持久化到数据库，共享同一个批次标识

### 需求 3：内容库管理

**用户故事：** 作为运营人员，我希望查看和管理历史生成的笔记内容，以便复用优质文案和追踪产出。

#### 验收标准

1. WHEN Operator 访问内容库页面, THE Content_Library SHALL 按生成时间倒序展示所有历史笔记记录，支持分页
2. WHEN Operator 按内容类型筛选, THE Content_Library SHALL 仅返回匹配该类型的笔记记录
3. WHEN Operator 按关键词搜索, THE Content_Library SHALL 返回主题或正文中包含该关键词的记录
4. WHEN Operator 点击某条笔记记录, THE Content_Library SHALL 展示该笔记的完整内容（标题、正文、话题标签、图片描述提示）及其效果数据
5. WHEN Operator 删除一条笔记记录, THE Content_Library SHALL 从数据库中移除该记录并更新列表

### 需求 4：效果数据回填

**用户故事：** 作为运营人员，我希望在笔记发布后回填效果数据（浏览量、点赞等），以便追踪内容表现和优化后续生成。

#### 验收标准

1. WHEN Operator 选择一条已生成的笔记记录, THE 系统 SHALL 提供效果数据回填表单，包含浏览量、点赞数、收藏数、评论数、涨粉数字段
2. WHEN Operator 提交效果数据, THE Content_Library SHALL 将 Performance_Data 持久化到数据库，关联对应的笔记记录
3. WHEN Operator 更新已有效果数据, THE Content_Library SHALL 覆盖更新对应字段的值
4. WHEN 效果数据已回填, THE Content_Library SHALL 在笔记列表中展示关键指标（浏览量、点赞数）作为摘要信息

### 需求 5：内容效果分析

**用户故事：** 作为运营人员，我希望查看内容效果的统计分析，以便了解哪类内容表现更好，指导后续内容策略。

#### 验收标准

1. WHEN Operator 访问效果分析页面, THE Content_Analyzer SHALL 按内容类型维度聚合展示平均浏览量、平均点赞数、平均收藏数
2. WHEN Operator 查看分析数据, THE Content_Analyzer SHALL 标识出表现最优的内容类型和主题关键词
3. WHEN 有足够的效果数据（至少 5 条已回填记录）, THE Content_Analyzer SHALL 生成内容表现排行榜，按综合互动指标排序

### 需求 6：AI 优化生成

**用户故事：** 作为运营人员，我希望 AI 能基于历史效果数据自动优化内容生成策略，以便持续提升内容质量和引流效果。

#### 验收标准

1. WHEN Content_Generator 生成新内容时, THE Content_Generator SHALL 查询历史高表现笔记（按互动指标排序前 N 条），将其作为参考示例传递给 LLM
2. WHEN 历史数据中存在高表现笔记, THE Content_Generator SHALL 在 Prompt 中包含高表现笔记的标题和正文风格特征，引导 LLM 学习成功模式
3. IF 历史效果数据不足（少于 3 条已回填记录）, THEN THE Content_Generator SHALL 使用默认 Prompt 模板生成内容，不注入历史参考

### 需求 7：一键复制功能

**用户故事：** 作为运营人员，我希望一键复制笔记的各部分内容，以便快速粘贴到小红书编辑器发布。

#### 验收标准

1. WHEN Operator 点击标题复制按钮, THE 系统 SHALL 将笔记标题复制到系统剪贴板
2. WHEN Operator 点击正文复制按钮, THE 系统 SHALL 将笔记正文（含 emoji 排版）复制到系统剪贴板
3. WHEN Operator 点击话题标签复制按钮, THE 系统 SHALL 将所有话题标签以 "#标签1 #标签2" 格式复制到系统剪贴板
4. WHEN Operator 点击全文复制按钮, THE 系统 SHALL 将标题 + 正文 + 话题标签组合后复制到系统剪贴板
5. WHEN 复制操作成功, THE 系统 SHALL 显示短暂的成功提示反馈

### 需求 8：Prompt 模板配置

**用户故事：** 作为运营人员，我希望通过现有配置系统管理生成 Prompt 模板，以便持续优化生成效果。

#### 验收标准

1. THE Content_Generator SHALL 通过 getConfigValue 读取 Prompt_Template，支持热更新（缓存 30 秒过期）
2. THE Prompt_Template SHALL 包含内容类型、品牌调性指引、小红书平台规则和输出格式要求作为模板变量
3. WHEN Prompt_Template 在配置系统中被更新, THE Content_Generator SHALL 在下次生成时使用新模板

### 需求 9：趋势数据联动

**用户故事：** 作为运营人员，我希望在生成内容时参考当前热门趋势，以便产出更贴合用户兴趣的引流内容。

#### 验收标准

1. WHEN Operator 进入内容生成页面, THE 系统 SHALL 展示来自 Trend_Insight 的当前热门关键词列表
2. WHEN Operator 点击某个热门关键词, THE 系统 SHALL 将该关键词自动填入主题输入框
3. WHEN Content_Generator 生成内容时, THE Content_Generator SHALL 可选地将热门关键词作为上下文传递给 LLM，提升内容与当前热点的相关性

### 需求 10：内容运营 API

**用户故事：** 作为系统开发者，我希望内容运营功能通过 RESTful API 暴露，以便管理后台前端调用。

#### 验收标准

1. THE Growth 模块 SHALL 提供 POST /growth/content/generate 端点，接收主题、内容类型、生成数量和可选热门关键词参数，返回生成的笔记列表
2. THE Growth 模块 SHALL 提供 GET /growth/content/library 端点，支持分页、内容类型筛选和关键词搜索参数
3. THE Growth 模块 SHALL 提供 GET /growth/content/library/:id 端点，返回单条笔记的完整详情（含效果数据）
4. THE Growth 模块 SHALL 提供 DELETE /growth/content/library/:id 端点，删除指定笔记记录
5. THE Growth 模块 SHALL 提供 PUT /growth/content/library/:id/performance 端点，接收效果数据回填
6. THE Growth 模块 SHALL 提供 GET /growth/content/analytics 端点，返回内容效果分析统计数据
7. WHEN 未认证用户访问以上端点, THE Growth 模块 SHALL 返回 401 未授权错误
