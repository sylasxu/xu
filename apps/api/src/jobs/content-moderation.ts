/**
 * 内容审核定时任务
 * 
 * 定期扫描新创建的活动，进行风险评估
 * 高风险活动记录到日志，后续可扩展自动处理
 */

import { db, sql, toTimestamp, activities } from '@xu/db';
import { analyzeContent } from '../modules/ai/moderation/moderation.service';

/**
 * 扫描最近创建的活动进行风险评估
 */
export async function runContentModeration(): Promise<void> {
  try {
    // 获取最近 1 小时内创建的活动
    const since = new Date(Date.now() - 60 * 60 * 1000);
    
    const recentActivities = await db.query.activities.findMany({
      where: sql`${activities.createdAt} >= ${toTimestamp(since)}`,
      columns: {
        id: true,
        title: true,
        description: true,
        creatorId: true,
      },
    });

    if (recentActivities.length === 0) {
      console.log('[内容审核] 最近 1 小时无新活动');
      return;
    }

    console.log(`[内容审核] 扫描 ${recentActivities.length} 个新活动`);

    let highRiskCount = 0;
    let mediumRiskCount = 0;

    for (const activity of recentActivities) {
      const result = await analyzeContent(activity.title, activity.description);
      
      if (result.riskLevel === 'high') {
        highRiskCount++;
        console.log(`[内容审核] 高风险活动: ${activity.id} - ${activity.title}`);
        console.log(`  风险原因: ${result.reasons.join(', ')}`);
        console.log(`  建议操作: ${result.suggestedAction}`);
        
        // TODO: 后续可以自动标记或隐藏高风险活动
        // await markActivityAsRisky(activity.id, result);
      } else if (result.riskLevel === 'medium') {
        mediumRiskCount++;
      }
    }

    console.log(`[内容审核] 完成: 高风险=${highRiskCount}, 中风险=${mediumRiskCount}`);
    
    // TODO: 后续可以发送通知给管理员
    // if (highRiskCount > 0) {
    //   await sendAdminNotification({
    //     type: 'high_risk_content',
    //     count: highRiskCount,
    //   });
    // }
  } catch (error) {
    console.error('[内容审核] 执行失败:', error);
    throw error;
  }
}
