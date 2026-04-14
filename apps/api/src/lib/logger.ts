/**
 * xu API 日志系统
 * 
 * 设计原则：
 * - 模块标签统一青色，作为分类标识
 * - HTTP 方法按语义着色：GET绿/POST黄/PUT蓝/PATCH青/DELETE红
 * - 状态码按语义着色：2xx绿/3xx青/4xx黄/5xx红
 * - 耗时按性能着色：正常灰/<500ms / 慢黄/>500ms / 很慢红/>1000ms
 * - 成功/失败图标：v绿 / x红
 */

import { Elysia } from 'elysia';
import pino from 'pino';
import chalk from 'chalk';

// ============ 类型定义 ============

interface RouteInfo {
  method: string;
  path: string;
}

interface ElysiaAppWithRoutes {
  routes?: RouteInfo[];
}

// ============ 配置 ============

export const isDev = process.env.NODE_ENV !== 'production';

// ============ Pino Logger 配置 ============

const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      messageFormat: '{msg}',
      ignore: 'pid,hostname',
      // 使用 Admin 主题 chart 色板
      customColors: 'info:greenBright,debug:blueBright,warn:yellowBright,error:redBright',
    },
  },
});

// ============ 颜色系统 (基于 Admin 主题 OKLCH) ============
// 设计原则：与 Admin 主题保持一致，深色模式色板

// 从 Admin theme.css 提取的 OKLCH 转 HEX (dark mode)
const c = {
  // 灰度系统 (基于 264 色相的蓝灰)
  bg: '#1a1625',           // oklch(0.129 0.042 264.695) - background
  fg: '#fafafa',           // oklch(0.984 0.003 247.858) - foreground  
  muted: '#3d3654',        // oklch(0.279 0.041 260.031) - muted
  mutedFg: '#9f93b8',      // oklch(0.704 0.04 256.788) - muted-foreground
  border: '#e5e5e5',       // oklch(0.929 0.013 255.508) - primary (light)
  
  // 语义色
  destructive: '#e85c5c',  // oklch(0.704 0.191 22.216) - destructive
  
  // Chart 色板 (用于点缀)
  chart1: '#6366f1',       // oklch(0.488 0.243 264.376) - 靛蓝
  chart2: '#22c55e',       // oklch(0.696 0.17 162.48) - 绿
  chart3: '#eab308',       // oklch(0.769 0.188 70.08) - 黄
  chart4: '#a855f7',       // oklch(0.627 0.265 303.9) - 紫
  chart5: '#ef4444',       // oklch(0.645 0.246 16.439) - 红
};

// 模块标签 - muted-foreground
const tag = (name: string) => chalk.hex(c.mutedFg)(`[${name}]`);

// HTTP 方法颜色
function colorMethod(method: string): string {
  const m = method.trim();
  switch (m) {
    case 'GET':    return chalk.hex(c.chart2)(m.padEnd(7));  // 绿
    case 'POST':   return chalk.hex(c.chart3)(m.padEnd(7));  // 黄
    case 'PUT':    return chalk.hex(c.chart1)(m.padEnd(7));  // 靛蓝
    case 'PATCH':  return chalk.hex(c.chart4)(m.padEnd(7));  // 紫
    case 'DELETE': return chalk.hex(c.chart5)(m.padEnd(7));  // 红
    default:       return chalk.hex(c.mutedFg)(m.padEnd(7));
  }
}

// 状态码颜色
function colorStatus(status: number): string {
  if (status >= 500) return chalk.hex(c.destructive)(String(status));
  if (status >= 400) return chalk.hex(c.chart3)(String(status));  // 黄
  if (status >= 300) return chalk.hex(c.mutedFg)(String(status));
  return chalk.hex(c.chart2)(String(status));  // 绿
}

// 耗时颜色
function colorDuration(ms: number): string {
  if (ms > 1000) return chalk.hex(c.destructive)(`${ms}ms`);
  if (ms > 500)  return chalk.hex(c.chart3)(`${ms}ms`);  // 黄
  return chalk.hex(c.mutedFg)(`${ms}ms`);
}

// 结果图标
const icon = {
  ok: chalk.hex(c.chart2)('✓'),
  fail: chalk.hex(c.destructive)('✗'),
};

// ============ Logger Plugin ============

export const loggerPlugin = new Elysia({ name: 'logger' })
  .decorate('log', logger)
  .derive(() => ({
    startTime: Date.now()
  }))
  .onRequest(({ request, log }) => {
    const { method, url } = request;
    const pathname = new URL(url).pathname;
    
    // 跳过噪音路由
    if (pathname === '/health' || pathname === '/favicon.ico' || pathname.startsWith('/openapi')) {
      return;
    }
    
    const requestId = crypto.randomUUID().slice(0, 8);
    const userAgent = request.headers.get('user-agent') || '-';
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    
    log.info({
      requestId,
      method,
      path: pathname,
      ip,
      userAgent: userAgent.slice(0, 50)
    }, `${tag('请求')} ${colorMethod(method)} ${chalk.hex(c.fg)(pathname)}`);
  })
  .onAfterResponse(({ request, set, startTime, log }) => {
    const { method, url } = request;
    const pathname = new URL(url).pathname;
    const duration = Date.now() - (startTime || 0);
    const status = typeof set.status === 'number' ? set.status : (typeof set.status === 'string' ? parseInt(set.status) : 200);
    
    // 跳过噪音路由
    if (pathname === '/health' || pathname === '/favicon.ico' || pathname.startsWith('/openapi')) {
      return;
    }
    
    const contentLength = set.headers?.['content-length'] || '-';
    const userId = '-'; // userId 从 JWT 解析，logger 层无法直接获取
    const statusIcon = status >= 400 ? icon.fail : icon.ok;
    
    const logData = {
      method,
      path: pathname,
      status,
      duration,
      contentLength,
      userId
    };
    const logMsg = `${tag('响应')} ${statusIcon} ${colorMethod(method)} ${chalk.hex(c.fg)(pathname)} ${colorStatus(status)} ${colorDuration(duration)}`;
    
    if (status >= 500) {
      log.error(logData, logMsg);
    } else if (status >= 400 || duration > 1000) {
      log.warn(logData, logMsg);
    } else {
      log.info(logData, logMsg);
    }
  })
  .onError(({ request, error, set, startTime, log }) => {
    const { method, url } = request;
    const pathname = new URL(url).pathname;
    const duration = Date.now() - (startTime || 0);
    const status = typeof set.status === 'number' ? set.status : (typeof set.status === 'string' ? parseInt(set.status) : 500);
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // 跳过噪音路由
    if (pathname === '/health' || pathname === '/favicon.ico' || pathname.startsWith('/openapi')) {
      return;
    }
    
    const userId = '-'; // userId 从 JWT 解析，logger 层无法直接获取
    
    log.error({
      method,
      path: pathname,
      status,
      duration,
      userId,
      error: errorMsg,
      stack: errorStack
    }, `${tag('错误')} ${icon.fail} ${colorMethod(method)} ${chalk.hex(c.fg)(pathname)} ${colorStatus(status)} ${colorDuration(duration)} ${chalk.hex(c.destructive)(errorMsg)}`);
  });

// ============ 启动日志 ============

export function printBanner(appName: string, version: string): void {
  if (!isDev) return;
  logger.info(`${tag('启动')} ${chalk.hex(c.fg).bold(appName)} ${chalk.hex(c.mutedFg)(`v${version}`)}`);
  logger.info(`${tag('环境')} ${chalk.hex(c.mutedFg)('Elysia + Bun')}`);
}

export function printStartupInfo(port: number, openapiPath?: string): void {
  if (!isDev) return;
  logger.info({ port }, `${tag('服务')} 运行在 ${chalk.hex(c.fg).underline(`http://localhost:${port}`)}`);
  if (openapiPath) {
    logger.info({ openapiPath }, `${tag('文档')} OpenAPI ${chalk.hex(c.mutedFg).underline(`http://localhost:${port}${openapiPath}`)}`);
  }
}

// ============ 路由打印 ============

export function printRoutes(app: ElysiaAppWithRoutes): void {
  if (!isDev) return;

  const routes = app.routes;
  if (!routes || routes.length === 0) {
    logger.warn(`${tag('路由')} 未发现任何路由`);
    return;
  }

  // 按模块分组
  const grouped = new Map<string, RouteInfo[]>();
  const moduleNameMap: Record<string, string> = {
    'ROOT': '根路径',
    'auth': '认证',
    'users': '用户', 
    'activities': '活动',
    'ai': 'AI',
    'participants': '参与者',
    'chat': '聊天',
    'dashboard': '仪表板',
    'notifications': '通知',
    'health': '健康检查',
    'jobs': '任务状态'
  };
  
  for (const route of routes) {
    if (route.path.startsWith('/openapi') || route.method === 'OPTIONS') continue;
    
    const segments = route.path.split('/').filter(Boolean);
    const module = segments[0] || 'ROOT';
    const moduleName = moduleNameMap[module] || module.toUpperCase();
    
    if (!grouped.has(moduleName)) {
      grouped.set(moduleName, []);
    }
    grouped.get(moduleName)!.push(route);
  }

  const moduleOrder = ['根路径', '认证', '用户', '活动', 'AI', '参与者', '聊天', '仪表板', '通知', '健康检查', '任务状态'];
  const sortedModules = [...grouped.keys()].sort((a, b) => {
    const aIndex = moduleOrder.indexOf(a);
    const bIndex = moduleOrder.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  logger.info(`${tag('路由')} 注册列表:`);
  
  for (const module of sortedModules) {
    const moduleRoutes = grouped.get(module);
    if (!moduleRoutes) continue;
    if (moduleRoutes.every(r => r.path.endsWith('/*'))) continue;
    
    logger.info(`  ${chalk.dim(`[${module}]`)}`);
    
    const filteredRoutes = moduleRoutes
      .filter(r => !r.path.endsWith('/*'))
      .sort((a, b) => a.path.localeCompare(b.path));
    
    for (const { method, path } of filteredRoutes) {
      logger.info({ method, path }, `    ${colorMethod(method)} ${chalk.hex(c.fg)(path)}`);
    }
  }
}

// ============ 定时任务日志 ============

export const jobLogger = {
  schedulerStart: (jobCount: number) => {
    logger.info({ jobCount }, `${tag('调度')} 启动 ${chalk.hex(c.mutedFg)(`(${jobCount} 个任务)`)}`);
  },

  schedulerStop: () => {
    logger.warn(`${tag('调度')} 停止`);
  },

  jobRegistered: (name: string, intervalSeconds: number) => {
    logger.info({ jobName: name, interval: intervalSeconds }, `${tag('调度')} 注册 ${chalk.hex(c.fg)(name)} ${chalk.hex(c.mutedFg)(`(每${intervalSeconds}秒)`)}`);
  },

  jobStart: (name: string) => {
    logger.info({ jobName: name }, `${tag('任务')} 开始 ${chalk.hex(c.fg)(name)}`);
  },

  jobSuccess: (name: string, duration: number) => {
    const msg = `${tag('任务')} ${icon.ok} ${chalk.hex(c.fg)(name)} ${colorDuration(duration)}`;
    if (duration > 5000) {
      logger.warn({ jobName: name, duration }, msg);
    } else {
      logger.info({ jobName: name, duration }, msg);
    }
  },

  jobError: (name: string, duration: number, error: any) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ jobName: name, duration, error: errorMsg }, 
      `${tag('任务')} ${icon.fail} ${chalk.hex(c.fg)(name)} ${colorDuration(duration)} ${chalk.hex(c.destructive)(errorMsg)}`);
  },

  jobSkipped: (name: string) => {
    logger.debug({ jobName: name }, `${tag('任务')} 跳过 ${chalk.hex(c.mutedFg)(name)} ${chalk.hex(c.mutedFg)('(执行中)')}`);
  },

  jobStats: (name: string, processed: number, affected: number = 0) => {
    const stats = affected > 0 
      ? `处理 ${chalk.hex(c.fg)(String(processed))} 条, 影响 ${chalk.hex(c.chart2)(String(affected))} 条`
      : processed > 0 
        ? `处理 ${chalk.hex(c.fg)(String(processed))} 条`
        : chalk.hex(c.mutedFg)('无待处理');
    logger.info({ jobName: name, processed, affected }, `${tag('统计')} ${chalk.hex(c.fg)(name)}: ${stats}`);
  }
};

// ============ 导出 ============

export function createLogger(context: string) {
  return logger.child({ context });
}
