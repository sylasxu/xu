// Poster Service - 海报生成业务逻辑
import { db, activities, eq } from '@juchang/db';
import { generateQRCode } from '../wechat/wechat.service';
import type { PosterStyle, GeneratePosterResponse } from './poster.model';
import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join } from 'path';

// 活动类型映射
const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  food: '美食',
  entertainment: '娱乐',
  sports: '运动',
  boardgame: '桌游',
  other: '其他',
};

// 海报风格配置
const STYLE_CONFIG: Record<PosterStyle, { 
  primaryColor: string; 
  bgGradient: string;
  fontFamily: string;
}> = {
  simple: {
    primaryColor: '#333333',
    bgGradient: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  vibrant: {
    primaryColor: '#ff6b6b',
    bgGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  artistic: {
    primaryColor: '#2d3436',
    bgGradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    fontFamily: '"Noto Serif SC", serif',
  },
};

interface ActivityData {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  locationName: string;
  locationHint: string;
  type: string;
  currentParticipants: number;
  maxParticipants: number;
}

/**
 * 获取活动信息
 */
async function getActivityById(activityId: string): Promise<ActivityData | null> {
  const [activity] = await db
    .select({
      id: activities.id,
      title: activities.title,
      description: activities.description,
      startAt: activities.startAt,
      locationName: activities.locationName,
      locationHint: activities.locationHint,
      type: activities.type,
      currentParticipants: activities.currentParticipants,
      maxParticipants: activities.maxParticipants,
    })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  return activity || null;
}

/**
 * 生成背景图（调用千问 VL）
 * 失败时返回默认背景
 */
async function generateBackground(
  activity: ActivityData,
  style: PosterStyle
): Promise<string | null> {
  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      console.warn('[Poster] DASHSCOPE_API_KEY not configured, using default background');
      return null;
    }

    const typeLabel = ACTIVITY_TYPE_LABELS[activity.type] || '活动';
    const prompt = `生成一张${typeLabel}活动的背景图，风格${style === 'simple' ? '简约清新' : style === 'vibrant' ? '活力四射' : '文艺复古'}，不要包含任何文字，适合作为海报背景，尺寸比例 9:16`;

    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'wanx-v1',
        input: {
          prompt,
        },
        parameters: {
          style: '<auto>',
          size: '720*1280',
          n: 1,
        },
      }),
    });

    const data = await response.json();
    
    if (data.output?.task_id) {
      // 轮询获取结果
      const imageUrl = await pollImageResult(data.output.task_id, apiKey);
      return imageUrl;
    }

    return null;
  } catch (error) {
    console.error('[Poster] Failed to generate background:', error);
    return null;
  }
}

/**
 * 轮询获取图片生成结果
 */
async function pollImageResult(taskId: string, apiKey: string, maxAttempts = 30): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json();

    if (data.output?.task_status === 'SUCCEEDED') {
      return data.output?.results?.[0]?.url || null;
    }

    if (data.output?.task_status === 'FAILED') {
      console.error('[Poster] Image generation failed:', data.output?.message);
      return null;
    }
  }

  console.warn('[Poster] Image generation timeout');
  return null;
}

/**
 * 格式化日期时间
 */
function formatDateTime(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[date.getDay()];
  
  return `${month}月${day}日 ${weekday} ${hours}:${minutes}`;
}

/**
 * 生成海报 HTML
 */
function generatePosterHtml(
  activity: ActivityData,
  style: PosterStyle,
  backgroundUrl: string | null,
  qrcodeBase64: string
): string {
  const config = STYLE_CONFIG[style];
  const typeLabel = ACTIVITY_TYPE_LABELS[activity.type] || '其他';
  const dateTime = formatDateTime(activity.startAt);
  const participants = `${activity.currentParticipants}/${activity.maxParticipants}人`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 375px;
      height: 667px;
      font-family: ${config.fontFamily};
      background: ${backgroundUrl ? `url(${backgroundUrl}) center/cover` : config.bgGradient};
      position: relative;
      overflow: hidden;
    }
    .overlay {
      position: absolute;
      inset: 0;
      background: ${backgroundUrl ? 'rgba(0,0,0,0.3)' : 'transparent'};
    }
    .content {
      position: relative;
      z-index: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 40px 24px;
      color: ${backgroundUrl ? '#fff' : config.primaryColor};
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: ${config.primaryColor};
      color: #fff;
      border-radius: 16px;
      font-size: 12px;
      margin-bottom: 16px;
      width: fit-content;
    }
    .title {
      font-size: 28px;
      font-weight: bold;
      line-height: 1.3;
      margin-bottom: 24px;
    }
    .info-item {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .info-icon {
      width: 20px;
      margin-right: 8px;
    }
    .spacer { flex: 1; }
    .qrcode-section {
      text-align: center;
    }
    .qrcode {
      width: 120px;
      height: 120px;
      background: #fff;
      border-radius: 8px;
      padding: 8px;
      margin: 0 auto 12px;
    }
    .qrcode img {
      width: 100%;
      height: 100%;
    }
    .scan-tip {
      font-size: 12px;
      opacity: 0.8;
    }
    .brand {
      margin-top: 16px;
      font-size: 12px;
      opacity: 0.6;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="overlay"></div>
  <div class="content">
    <span class="badge">${typeLabel}</span>
    <h1 class="title">${activity.title}</h1>
    
    <div class="info-item">
      <span class="info-icon">📅</span>
      <span>${dateTime}</span>
    </div>
    <div class="info-item">
      <span class="info-icon">📍</span>
      <span>${activity.locationName}</span>
    </div>
    <div class="info-item">
      <span class="info-icon">🗺️</span>
      <span>${activity.locationHint}</span>
    </div>
    <div class="info-item">
      <span class="info-icon">👥</span>
      <span>${participants}</span>
    </div>
    
    <div class="spacer"></div>
    
    <div class="qrcode-section">
      <div class="qrcode">
        <img src="${qrcodeBase64}" alt="小程序码" />
      </div>
      <p class="scan-tip">扫码查看活动详情</p>
    </div>
    
    <p class="brand">聚场 · 一起玩更有趣</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * 使用 Puppeteer 渲染海报
 */
async function renderPoster(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const screenshot = await page.screenshot({
      type: 'png',
      encoding: 'binary',
    });

    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}

/**
 * 上传图片到 OSS（简化版：返回 base64 data URL）
 * TODO: 实际项目中应上传到 OSS 并返回 URL
 */
async function uploadToOss(buffer: Buffer): Promise<string> {
  // 简化实现：返回 base64 data URL
  // 实际项目中应上传到阿里云 OSS 或其他存储服务
  const base64 = buffer.toString('base64');
  return `data:image/png;base64,${base64}`;
}

/**
 * 生成活动海报
 */
export async function generatePoster(
  activityId: string,
  style: PosterStyle
): Promise<GeneratePosterResponse> {
  // 1. 获取活动信息
  const activity = await getActivityById(activityId);
  if (!activity) {
    throw new Error('活动不存在');
  }

  // 2. 生成背景图（千问 VL）
  const backgroundUrl = await generateBackground(activity, style);

  // 3. 生成小程序码
  const qrcodeBuffer = await generateQRCode(
    `subpackages/activity/detail/index?id=${activityId}`
  );
  const qrcodeBase64 = `data:image/png;base64,${qrcodeBuffer.toString('base64')}`;

  // 4. 生成海报 HTML
  const html = generatePosterHtml(activity, style, backgroundUrl, qrcodeBase64);

  // 5. 渲染海报
  const posterBuffer = await renderPoster(html);

  // 6. 上传到 OSS
  const posterUrl = await uploadToOss(posterBuffer);

  return {
    posterUrl,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
