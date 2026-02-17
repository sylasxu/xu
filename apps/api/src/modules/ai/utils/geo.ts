/**
 * 地理位置工具函数
 * 
 * 从 ai.service.ts 迁移的辅助函数
 */

/**
 * 简易反向地理编码：根据经纬度返回地名
 * 
 * 基于预定义的重庆主要商圈坐标匹配
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const locations = [
    { name: '观音桥', lat: 29.5630, lng: 106.5516, radius: 0.02 },
    { name: '解放碑', lat: 29.5647, lng: 106.5770, radius: 0.02 },
    { name: '南坪', lat: 29.5230, lng: 106.5516, radius: 0.02 },
    { name: '沙坪坝', lat: 29.5410, lng: 106.4550, radius: 0.02 },
  ];
  for (const loc of locations) {
    if (Math.sqrt(Math.pow(lat - loc.lat, 2) + Math.pow(lng - loc.lng, 2)) <= loc.radius) return loc.name;
  }
  return '附近';
}
