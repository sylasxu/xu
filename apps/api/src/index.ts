// Elysia API Server Entry
import { config } from 'dotenv';
import { fileURLToPath } from 'url';

// 加载根目录的 .env 文件
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { Elysia } from 'elysia';
import { AuthError, basePlugins, verifyAdmin } from './setup';
import { openapi } from '@elysiajs/openapi';

// 导入 Logger
import { loggerPlugin, printBanner, printRoutes, printStartupInfo } from './lib/logger';

// 导入路由模块（Controller）
import { authController } from './modules/auth/auth.controller';
import { userController } from './modules/users/user.controller';
import { activityController } from './modules/activities/activity.controller';
import { aiController } from './modules/ai/ai.controller';
import { participantController } from './modules/participants/participant.controller';
import { chatController } from './modules/chat/chat.controller';
import { notificationController } from './modules/notifications/notification.controller';
import { reportController } from './modules/reports/report.controller';
import { hotKeywordsController } from './modules/hot-keywords/hot-keywords.controller';
import { contentController } from './modules/content/content.controller';
import { ensureSystemPromptConfigured } from './modules/ai/prompts';

// 导入定时任务调度器
import { startScheduler, stopScheduler, getJobStatuses } from './jobs';

type JobsStatusSuccessResponse = {
  jobs: ReturnType<typeof getJobStatuses>;
  timestamp: string;
};

type JobsStatusErrorResponse = {
  code: number;
  msg: string;
};

const openApiPlugin = openapi({
  documentation: {
    info: {
      title: '聚场 API',
      version: '1.0.0',
      description: '帮助用户更容易参加一场局的聚场后端 API',
    },
    tags: [
      { name: 'Auth', description: '认证相关' },
      { name: 'AI', description: '主对话链路、任务续接与会话承接' },
      { name: 'Activities', description: '活动管理' },
      { name: 'Participants', description: '参与者管理' },
      { name: 'Chat', description: '群聊消息' },
      { name: 'Notifications', description: '通知系统' },
      { name: 'Content', description: '内容运营' },
      { name: 'Hot Keywords', description: '全局关键词' },
      { name: 'Internal', description: '低频内部运维、排障与冻结接口，不属于主流程 API 门面' },
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
    showDeveloperTools: 'never',
    hideSearch: false,
    showOperationId: false,
    hideDarkModeToggle: false,
    withDefaultFonts: true,
    expandAllModelSections: false,
    orderSchemaPropertiesBy: 'alpha',
    orderRequiredPropertiesFirst: true,
  },
});

async function getJobsStatusHandler(
  context: any
): Promise<JobsStatusSuccessResponse | JobsStatusErrorResponse> {
  const { jwt, headers, set } = context;

  if (process.env.NODE_ENV !== 'production') {
    return {
      jobs: getJobStatuses(),
      timestamp: new Date().toISOString(),
    };
  }

  try {
    await verifyAdmin(jwt, headers);
    return {
      jobs: getJobStatuses(),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      set.status = error.status;
      return {
        code: error.status,
        msg: error.message,
      };
    }

    set.status = 500;
    return {
      code: 500,
      msg: '获取任务状态失败',
    };
  }
}

const appWithBase = new Elysia()
  .use(loggerPlugin)
  .use(basePlugins)
  .use(openApiPlugin);

export const app = appWithBase
  // 健康检查
  .get('/', () => 'Hello Juchang API')
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
  // 定时任务状态查询（仅供调试）
  .get('/jobs/status', getJobsStatusHandler)
  // 核心业务模块
  .use(authController)
  .use(userController)
  .use(activityController)
  .use(aiController)
  .use(participantController)
  .use(chatController)
  .use(notificationController)
  .use(reportController)
  .use(hotKeywordsController)
  .use(contentController);

if (import.meta.main) {
  // 打印启动 Banner
  printBanner('聚场 API', '1.0.0');

  // 启动服务器
  const port = Number(process.env.API_PORT || 3000);
  const host = process.env.API_HOST || '0.0.0.0'; // 默认监听所有网卡，支持局域网访问

  try {
    await ensureSystemPromptConfigured();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error(`❌ AI 启动校验失败: ${message}`);
    process.exit(1);
  }

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
}

// 导出类型给 Eden Treaty
export type App = typeof app;
