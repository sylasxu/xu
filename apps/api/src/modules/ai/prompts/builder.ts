/**
 * Prompt Builder - 动态 Prompt 构建
 * 
 * 提供 Prompt 构建的工具函数
 */

/**
 * 格式化日期时间（中文友好格式）
 */
export function formatDateTime(date: Date): string {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const weekday = weekdays[date.getDay()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${weekday} ${hours}:${minutes}`;
}

/**
 * 获取明天的日期字符串
 */
export function getTomorrowStr(currentTime: Date): string {
  const tomorrow = new Date(currentTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
}

/**
 * XML 转义
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

