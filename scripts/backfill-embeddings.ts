#!/usr/bin/env bun
/**
 * Embedding 回填脚本
 * 
 * 为现有活动生成向量 embedding
 * 
 * 用法:
 *   bun run scripts/backfill-embeddings.ts [options]
 * 
 * 选项:
 *   --force     强制重新生成所有 embedding（包括已有的）
 *   --dry-run   仅打印将要处理的活动，不实际执行
 *   --batch=N   每批处理数量，默认 100
 *   --delay=N   批次间延迟（毫秒），默认 100
 */

import { db, eq, isNull, and, sql } from '@xu/db';
import { activities } from '@xu/db';
import type { Activity } from '@xu/db';
import { indexActivity } from '../apps/api/src/modules/ai/rag';

// 解析命令行参数
const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const batchArg = args.find(a => a.startsWith('--batch='));
const delayArg = args.find(a => a.startsWith('--delay='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 100;
const delayMs = delayArg ? parseInt(delayArg.split('=')[1], 10) : 100;

console.log('🚀 Embedding 回填脚本');
console.log('='.repeat(50));
console.log(`配置:`);
console.log(`  - 强制模式: ${force ? '是' : '否'}`);
console.log(`  - 试运行: ${dryRun ? '是' : '否'}`);
console.log(`  - 批次大小: ${batchSize}`);
console.log(`  - 批次延迟: ${delayMs}ms`);
console.log('');

async function main() {
  // 1. 查询需要处理的活动
  const whereCondition = force
    ? sql`${activities.status} IN ('active', 'completed')`
    : and(
        sql`${activities.status} IN ('active', 'completed')`,
        isNull(activities.embedding)
      );

  const activitiesToProcess = await db.query.activities.findMany({
    where: whereCondition,
    orderBy: (activities, { desc }) => [desc(activities.createdAt)],
  });

  console.log(`📊 找到 ${activitiesToProcess.length} 个活动需要处理`);
  
  if (activitiesToProcess.length === 0) {
    console.log('✅ 没有需要处理的活动');
    return;
  }

  if (dryRun) {
    console.log('\n📋 将要处理的活动:');
    for (const activity of activitiesToProcess.slice(0, 10)) {
      console.log(`  - [${activity.id.slice(0, 8)}] ${activity.title}`);
    }
    if (activitiesToProcess.length > 10) {
      console.log(`  ... 还有 ${activitiesToProcess.length - 10} 个活动`);
    }
    console.log('\n⚠️  试运行模式，未实际执行');
    return;
  }

  // 2. 批量处理
  let success = 0;
  let failed = 0;
  const errors: Array<{ id: string; title: string; error: string }> = [];

  console.log('\n🔄 开始处理...\n');

  for (let i = 0; i < activitiesToProcess.length; i += batchSize) {
    const batch = activitiesToProcess.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(activitiesToProcess.length / batchSize);
    
    console.log(`📦 处理批次 ${batchNum}/${totalBatches} (${batch.length} 个活动)`);

    for (const activity of batch) {
      try {
        await indexActivity(activity as Activity);
        success++;
        process.stdout.write('.');
      } catch (error) {
        failed++;
        process.stdout.write('x');
        errors.push({
          id: activity.id,
          title: activity.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(''); // 换行

    // 批次间延迟
    if (i + batchSize < activitiesToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // 3. 输出结果
  console.log('\n' + '='.repeat(50));
  console.log('📊 处理结果:');
  console.log(`  ✅ 成功: ${success}`);
  console.log(`  ❌ 失败: ${failed}`);

  if (errors.length > 0) {
    console.log('\n❌ 失败详情:');
    for (const err of errors.slice(0, 10)) {
      console.log(`  - [${err.id.slice(0, 8)}] ${err.title}: ${err.error}`);
    }
    if (errors.length > 10) {
      console.log(`  ... 还有 ${errors.length - 10} 个错误`);
    }
  }

  console.log('\n✅ 回填完成');
}

main().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
