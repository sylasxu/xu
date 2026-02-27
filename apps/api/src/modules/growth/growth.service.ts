// Growth Service - BFF 聚合层
// 从业务逻辑层变为轻量级聚合层，调用各领域服务

// 导入各领域服务
import { generateContent } from '../ai/ai.service';
import { getTrendInsights as getAnalyticsTrends } from '../analytics/analytics.service';
import { generateNotes } from '../content/content.service';

/**
 * 生成文案（海报工厂）
 * 重构后：调用 AI 领域的内容生成能力
 */
export async function generatePoster(
  text: string,
  style: 'minimal' | 'cyberpunk' | 'handwritten'
): Promise<{ headline: string; subheadline: string; body: string; cta: string; hashtags: string[] }> {
  // 调用 AI 领域的内容生成
  const result = await generateContent({
    topic: text,
    contentType: 'poster',
    style,
    count: 1,
  });

  const item = result.items[0];
  
  return {
    headline: item.title,
    subheadline: item.hashtags.slice(0, 3).join(' '),
    body: item.body.slice(0, 100),
    cta: '点击参与',
    hashtags: item.hashtags,
  };
}

/**
 * 获取热门洞察
 * 重构后：调用 Analytics 领域的趋势分析能力
 */
export async function getTrendInsights(period: '7d' | '30d') {
  // 调用 Analytics 领域的趋势分析
  return getAnalyticsTrends({ period, source: 'conversations' });
}
