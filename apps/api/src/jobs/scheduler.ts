/**
 * 定时任务调度器
 * 基于 setInterval 实现简单的定时任务系统
 * 
 * 任务列表：
 * 1. 履约超时自动确认 - 活动结束后 48h 未确认自动标记全员履约
 * 2. 申诉超时自动处理 - 申诉提交后 72h 未处理自动扣分
 * 3. 活动状态自动更新 - 根据时间自动更新活动状态
 * 4. 意向过期处理 - 每小时检查并更新过期意向状态 (v4.0)
 * 5. 匹配过期处理 - 每 10 分钟检查过期匹配 (v4.0)
 */

import { processExpiredFulfillments } from './fulfillment-timeout';
import { processExpiredDisputes } from './dispute-timeout';
import { processPostActivity } from './post-activity';
import { processActivityReminder } from './activity-reminder';
import { expireOldIntents, handleExpiredMatches } from './intent-jobs';
import { runAnomalyDetection } from './anomaly-detection';
import { runContentModeration } from './content-moderation';
import { summarizeUserMemories } from './memory-summarize';
import { jobLogger } from '../lib/logger';

interface ScheduledJob {
  name: string;
  interval: number; // 毫秒
  handler: () => Promise<void>;
  lastRun?: Date;
  isRunning: boolean;
}

const jobs: ScheduledJob[] = [
  {
    name: '履约超时自动确认',
    interval: 60 * 60 * 1000, // 每小时执行
    handler: processExpiredFulfillments,
    isRunning: false,
  },
  {
    name: '申诉超时自动处理',
    interval: 60 * 60 * 1000, // 每小时执行
    handler: processExpiredDisputes,
    isRunning: false,
  },
  {
    name: 'Post-Activity 自动完成',
    interval: 5 * 60 * 1000, // 每5分钟执行
    handler: processPostActivity,
    isRunning: false,
  },
  {
    name: '活动前提醒',
    interval: 5 * 60 * 1000, // 每5分钟执行
    handler: processActivityReminder,
    isRunning: false,
  },
  // v4.0 Partner Intent Jobs
  {
    name: '意向过期处理',
    interval: 60 * 60 * 1000, // 每小时执行
    handler: expireOldIntents,
    isRunning: false,
  },
  {
    name: '匹配过期处理',
    interval: 10 * 60 * 1000, // 每10分钟执行
    handler: handleExpiredMatches,
    isRunning: false,
  },
  // AI 运营任务
  {
    name: '异常检测扫描',
    interval: 30 * 60 * 1000, // 每30分钟执行
    handler: runAnomalyDetection,
    isRunning: false,
  },
  {
    name: '内容审核扫描',
    interval: 60 * 60 * 1000, // 每小时执行
    handler: runContentModeration,
    isRunning: false,
  },
  // Memory 汇总任务
  {
    name: '用户记忆汇总',
    interval: 24 * 60 * 60 * 1000, // 每24小时执行
    handler: summarizeUserMemories,
    isRunning: false,
  },
];

const timers: NodeJS.Timeout[] = [];

/**
 * 执行单个任务（带锁防止重复执行）
 */
async function runJob(job: ScheduledJob): Promise<void> {
  if (job.isRunning) {
    jobLogger.jobSkipped(job.name);
    return;
  }

  job.isRunning = true;
  const startTime = Date.now();

  try {
    jobLogger.jobStart(job.name);
    await job.handler();
    job.lastRun = new Date();
    const duration = Date.now() - startTime;
    jobLogger.jobSuccess(job.name, duration);
  } catch (error) {
    const duration = Date.now() - startTime;
    jobLogger.jobError(job.name, duration, error);
  } finally {
    job.isRunning = false;
  }
}

/**
 * 启动所有定时任务
 */
export function startScheduler(): void {
  jobLogger.schedulerStart(jobs.length);

  for (const job of jobs) {
    // 立即执行一次
    runJob(job);

    // 设置定时执行
    const timer = setInterval(() => runJob(job), job.interval);
    timers.push(timer);

    jobLogger.jobRegistered(job.name, job.interval / 1000);
  }
}

/**
 * 停止所有定时任务
 */
export function stopScheduler(): void {
  jobLogger.schedulerStop();

  for (const timer of timers) {
    clearInterval(timer);
  }

  timers.length = 0;
}

/**
 * 获取任务状态
 */
export function getJobStatuses(): Array<{
  name: string;
  interval: number;
  lastRun?: Date;
  isRunning: boolean;
}> {
  return jobs.map((job) => ({
    name: job.name,
    interval: job.interval,
    lastRun: job.lastRun,
    isRunning: job.isRunning,
  }));
}
