// Elysia API Server Entry
import { config } from 'dotenv';
import { resolve } from 'path';

// 加载根目录的 .env 文件
config({ path: resolve(process.cwd(), '../../.env') });

import { Elysia } from 'elysia';
import { basePlugins } from './setup';
import { openapi } from '@elysiajs/openapi';

// 导入 Logger
import { loggerPlugin, printBanner, printRoutes, printStartupInfo } from './lib/logger';

// 导入路由模块（Controller）
import { authController } from './modules/auth/auth.controller';
import { userController } from './modules/users/user.controller';
import { activityController } from './modules/activities/activity.controller';
import { aiController } from './modules/ai/ai.controller';
import { participantController } from './modules/participants/participant.controller';
import { dashboardController } from './modules/dashboard/dashboard.controller';
import { chatController } from './modules/chat/chat.controller';
import { notificationController } from './modules/notifications/notification.controller';
import { reportController } from './modules/reports/report.controller';
import { moderationController } from './modules/ai/moderation/moderation.controller';
import { anomalyController } from './modules/ai/anomaly/anomaly.controller';
import { growthController } from './modules/growth/growth.controller';
import { hotKeywordsController } from './modules/hot-keywords/hot-keywords.controller';

// 导入定时任务调度器
import { startScheduler, stopScheduler, getJobStatuses } from './jobs';

// 打印启动 Banner
printBanner('聚场 API', '1.0.0');

// 创建 Elysia 应用
const app = new Elysia()
  .use(loggerPlugin)  // 最先注册日志插件
  .use(basePlugins)
  .use(openapi({
    documentation: {
      info: {
        title: '聚场 API',
        version: '1.0.0',
        description: 'LBS-based P2P social platform API - MVP Version',
      },
      tags: [
        { name: 'Auth', description: '认证相关' },
        { name: 'Users', description: '用户管理' },
        { name: 'Activities', description: '活动管理' },
        { name: 'AI', description: 'AI 功能' },
        { name: 'Participants', description: '参与者管理' },
        { name: 'Chat', description: '群聊消息' },
        { name: 'Dashboard', description: '仪表板数据' },
        { name: 'Notifications', description: '通知系统' },
        { name: 'Reports', description: '内容审核' },
        { name: 'Hot Keywords', description: '全局关键词' },
        { name: 'Hot Keywords - Admin', description: '全局关键词管理' },
      ],
    },
    scalar: {
      defaultOpenAllTags: true,
      expandAllResponses: true,
      hideClientButton: true,
      showSidebar: true,
      showToolbar: 'localhost',
      operationTitleSource: 'summary',
      theme: 'default',
      persistAuth: false,
      layout: 'modern',
      hideModels: false,
      documentDownloadType: 'both',
      hideTestRequestButton: false,
      showDeveloperTools: "never",
      hideSearch: false,
      showOperationId: false,
      hideDarkModeToggle: false,
      withDefaultFonts: true,
      expandAllModelSections: false,
      orderSchemaPropertiesBy: 'alpha',
      orderRequiredPropertiesFirst: true,
    },
  }))
  // 核心业务模块
  .use(authController)
  .use(userController)
  .use(activityController)
  .use(aiController)
  .use(participantController)
  .use(chatController)
  .use(dashboardController)
  .use(notificationController)
  .use(reportController)
  .use(moderationController)
  .use(anomalyController)
  .use(growthController)
  .use(hotKeywordsController)
  // 健康检查
  .get('/', () => 'Hello Juchang API')
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
  // 定时任务状态查询（仅供调试）
  .get('/jobs/status', () => ({
    jobs: getJobStatuses(),
    timestamp: new Date().toISOString(),
  }));

// 启动服务器
const port = Number(process.env.API_PORT || 3000);
const host = process.env.API_HOST || '0.0.0.0'; // 默认监听所有网卡，支持局域网访问

app.listen({ port, hostname: host }, () => {
  // 打印路由列表
  printRoutes(app);

  // 打印启动信息
  printStartupInfo(port, '/openapi');

  // 启动定时任务调度器
  startScheduler();
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  stopScheduler();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n正在关闭服务器...');
  stopScheduler();
  process.exit(0);
});

// 导出类型给 Eden Treaty
export type App = typeof app;
