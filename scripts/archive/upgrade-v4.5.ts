#!/usr/bin/env bun
/**
 * v4.5 数据迁移脚本
 * 
 * 整合数据库升级和 embedding 回填
 * 
 * 用法:
 *   bun run scripts/upgrade-v4.5.ts [options]
 * 
 * 选项:
 *   --dry-run   仅打印将要执行的操作，不实际执行
 *   --skip-db   跳过数据库 schema 同步
 *   --skip-backfill  跳过 embedding 回填
 */

import { db, sql } from '@xu/db';
import { activities } from '@xu/db';
import type { Activity } from '@xu/db';
import { indexActivity } from '../apps/api/src/modules/ai/rag';

// 解析命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipDb = args.includes('--skip-db');
const skipBackfill = args.includes('--skip-backfill');

console.log('🚀 v4.5 数据迁移脚本');
console.log('='.repeat(50));
console.log(`配置:`);
console.log(`  - 试运行: ${dryRun ? '是' : '否'}`);
console.log(`  - 跳过数据库同步: ${skipDb ? '是' : '否'}`);
console.log(`  - 跳过 embedding 回填: ${skipBackfill ? '是' : '否'}`);
console.log('');

async function checkPgvectorExtension(): Promise<boolean> {
  try {
    const result = await db.execute<{ extname: string }>(sql`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `);
    return result.length > 0;
  } catch {
    return false;
  }
}

async function checkEmbeddingColumn(): Promise<boolean> {
  try {
    const result = await db.execute<{ column_name: string }>(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'activities' AND column_name = 'embedding'
    `);
    return result.length > 0;
  } catch {
    return false;
  }
}

async function checkEmbeddingIndex(): Promise<boolean> {
  try {
    const result = await db.execute<{ indexname: string }>(sql`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'activities' AND indexname = 'activities_embedding_idx'
    `);
    return result.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const steps: Array<{ name: string; status: 'pending' | 'done' | 'skipped' | 'error'; message?: string }> = [];

  // Step 1: 检查 pgvector 扩展
  console.log('\n📋 Step 1: 检查 pgvector 扩展');
  const hasPgvector = await checkPgvectorExtension();
  if (hasPgvector) {
    console.log('  ✅ pgvector 扩展已安装');
    steps.push({ name: 'pgvector 扩展', status: 'done' });
  } else {
    if (dryRun) {
      console.log('  ⚠️  pgvector 扩展未安装，需要执行: CREATE EXTENSION vector');
      steps.push({ name: 'pgvector 扩展', status: 'pending', message: '需要安装' });
    } else if (skipDb) {
      console.log('  ⏭️  跳过数据库同步');
      steps.push({ name: 'pgvector 扩展', status: 'skipped' });
    } else {
      try {
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
        console.log('  ✅ pgvector 扩展已安装');
        steps.push({ name: 'pgvector 扩展', status: 'done' });
      } catch (error) {
        console.log('  ❌ 安装 pgvector 扩展失败:', error);
        steps.push({ name: 'pgvector 扩展', status: 'error', message: String(error) });
      }
    }
  }

  // Step 2: 检查 embedding 列
  console.log('\n📋 Step 2: 检查 embedding 列');
  const hasEmbeddingColumn = await checkEmbeddingColumn();
  if (hasEmbeddingColumn) {
    console.log('  ✅ embedding 列已存在');
    steps.push({ name: 'embedding 列', status: 'done' });
  } else {
    if (dryRun) {
      console.log('  ⚠️  embedding 列不存在，需要执行: ALTER TABLE activities ADD COLUMN embedding vector(1536)');
      steps.push({ name: 'embedding 列', status: 'pending', message: '需要添加' });
    } else if (skipDb) {
      console.log('  ⏭️  跳过数据库同步');
      steps.push({ name: 'embedding 列', status: 'skipped' });
    } else {
      try {
        await db.execute(sql`ALTER TABLE activities ADD COLUMN embedding vector(1536)`);
        console.log('  ✅ embedding 列已添加');
        steps.push({ name: 'embedding 列', status: 'done' });
      } catch (error) {
        console.log('  ❌ 添加 embedding 列失败:', error);
        steps.push({ name: 'embedding 列', status: 'error', message: String(error) });
      }
    }
  }

  // Step 3: 检查 HNSW 索引
  console.log('\n📋 Step 3: 检查 HNSW 索引');
  const hasIndex = await checkEmbeddingIndex();
  if (hasIndex) {
    console.log('  ✅ HNSW 索引已存在');
    steps.push({ name: 'HNSW 索引', status: 'done' });
  } else {
    if (dryRun) {
      console.log('  ⚠️  HNSW 索引不存在，需要创建');
      steps.push({ name: 'HNSW 索引', status: 'pending', message: '需要创建' });
    } else if (skipDb) {
      console.log('  ⏭️  跳过数据库同步');
      steps.push({ name: 'HNSW 索引', status: 'skipped' });
    } else {
      try {
        await db.execute(sql`
          CREATE INDEX activities_embedding_idx 
          ON activities 
          USING hnsw (embedding vector_cosine_ops)
        `);
        console.log('  ✅ HNSW 索引已创建');
        steps.push({ name: 'HNSW 索引', status: 'done' });
      } catch (error) {
        console.log('  ❌ 创建 HNSW 索引失败:', error);
        steps.push({ name: 'HNSW 索引', status: 'error', message: String(error) });
      }
    }
  }

  // Step 4: Embedding 回填
  console.log('\n📋 Step 4: Embedding 回填');
  if (skipBackfill) {
    console.log('  ⏭️  跳过 embedding 回填');
    steps.push({ name: 'Embedding 回填', status: 'skipped' });
  } else {
    // 查询需要回填的活动
    const activitiesToBackfill = await db.query.activities.findMany({
      where: sql`${activities.status} IN ('active', 'completed') AND ${activities.embedding} IS NULL`,
    });

    console.log(`  📊 找到 ${activitiesToBackfill.length} 个活动需要回填`);

    if (activitiesToBackfill.length === 0) {
      console.log('  ✅ 没有需要回填的活动');
      steps.push({ name: 'Embedding 回填', status: 'done', message: '无需回填' });
    } else if (dryRun) {
      console.log('  ⚠️  试运行模式，不执行回填');
      for (const activity of activitiesToBackfill.slice(0, 5)) {
        console.log(`    - [${activity.id.slice(0, 8)}] ${activity.title}`);
      }
      if (activitiesToBackfill.length > 5) {
        console.log(`    ... 还有 ${activitiesToBackfill.length - 5} 个活动`);
      }
      steps.push({ name: 'Embedding 回填', status: 'pending', message: `${activitiesToBackfill.length} 个活动待回填` });
    } else {
      let success = 0;
      let failed = 0;

      console.log('  🔄 开始回填...');
      for (const activity of activitiesToBackfill) {
        try {
          await indexActivity(activity as Activity);
          success++;
          if (success % 10 === 0) {
            process.stdout.write('.');
          }
        } catch {
          failed++;
        }
      }
      console.log('');
      console.log(`  ✅ 回填完成: 成功 ${success}, 失败 ${failed}`);
      steps.push({ name: 'Embedding 回填', status: failed === 0 ? 'done' : 'error', message: `成功 ${success}, 失败 ${failed}` });
    }
  }

  // 输出总结
  console.log('\n' + '='.repeat(50));
  console.log('📊 迁移总结:');
  for (const step of steps) {
    const icon = step.status === 'done' ? '✅' : step.status === 'skipped' ? '⏭️' : step.status === 'pending' ? '⚠️' : '❌';
    const msg = step.message ? ` (${step.message})` : '';
    console.log(`  ${icon} ${step.name}${msg}`);
  }

  const hasErrors = steps.some(s => s.status === 'error');
  const hasPending = steps.some(s => s.status === 'pending');

  if (hasErrors) {
    console.log('\n❌ 迁移过程中有错误，请检查日志');
    process.exit(1);
  } else if (hasPending && dryRun) {
    console.log('\n⚠️  试运行完成，请移除 --dry-run 参数执行实际迁移');
  } else {
    console.log('\n✅ v4.5 迁移完成');
  }
}

main().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
