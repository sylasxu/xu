import { db } from './db';
import { users, activities, participants } from './schema';
import * as dotenv from 'dotenv';
import { seedAiConfigs } from './seed-ai-configs';

// 加载环境变量
dotenv.config({ path: '../../.env' });

async function seed() {
  console.log('🌱 开始种子数据...');

  try {
    // 0. 初始化 AI 参数配置（可在线编辑，不再写死前端）
    console.log('⚙️ 初始化 AI 参数配置...');
    await seedAiConfigs();
    console.log('✅ AI 参数配置初始化完成');

    // 1. 创建测试用户 (MVP 精简版)
    console.log('👤 创建测试用户...');
    const testUsers = await db.insert(users).values([
      {
        wxOpenId: 'test_openid_001',
        nickname: '张三',
        avatarUrl: 'https://example.com/avatar1.jpg',
        aiCreateQuotaToday: 3,
      },
      {
        wxOpenId: 'test_openid_002', 
        nickname: '李四',
        avatarUrl: 'https://example.com/avatar2.jpg',
        phoneNumber: '13800138001',
        aiCreateQuotaToday: 3,
      },
      {
        wxOpenId: 'test_openid_003',
        nickname: '王五',
        avatarUrl: 'https://example.com/avatar3.jpg',
        aiCreateQuotaToday: 1,
      },
    ]).returning();

    console.log(`✅ 创建了 ${testUsers.length} 个测试用户`);

    // 2. 创建测试活动 (MVP 精简版)
    console.log('🎯 创建测试活动...');
    const testActivities = await db.insert(activities).values([
      {
        creatorId: testUsers[0].id,
        title: '周五火锅局',
        description: '观音桥附近吃火锅，AA制，欢迎加入！',
        location: { x: 106.5516, y: 29.5630 }, // 重庆观音桥坐标
        locationName: '观音桥步行街',
        address: '重庆市江北区观音桥步行街',
        locationHint: '4楼平台入口',
        startAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2天后
        type: 'food',
        maxParticipants: 4,
        currentParticipants: 2,
        status: 'active',
      },
      {
        creatorId: testUsers[1].id,
        title: '解放碑剧本杀',
        description: '6人本《长安十二时辰》，需要有经验的玩家',
        location: { x: 106.5804, y: 29.5647 }, // 重庆解放碑坐标
        locationName: '解放碑步行街',
        address: '重庆市渝中区解放碑步行街',
        locationHint: '地下B1层',
        startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3天后
        type: 'boardgame',
        maxParticipants: 6,
        currentParticipants: 3,
        status: 'active',
      },
      {
        creatorId: testUsers[0].id,
        title: '南山夜跑团',
        description: '南山一棵树夜跑，约5公里，适合有跑步基础的朋友',
        location: { x: 106.6200, y: 29.5200 }, // 重庆南山坐标
        locationName: '南山一棵树观景台',
        address: '重庆市南岸区南山一棵树观景台',
        locationHint: '观景台停车场集合',
        startAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1天后
        type: 'sports',
        maxParticipants: 8,
        currentParticipants: 1,
        status: 'active',
      },
      {
        creatorId: testUsers[1].id,
        title: '大学城咖啡局 ☕',
        description: '周末下午一起喝咖啡聊天',
        location: { x: 106.5300, y: 29.5400 }, // 重庆大学城坐标
        locationName: '大学城商圈',
        address: '重庆市沙坪坝区大学城',
        locationHint: '轻轨站1号出口',
        startAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4天后
        type: 'other',
        maxParticipants: 4,
        currentParticipants: 1,
        status: 'active',
      },
    ]).returning();

    console.log(`✅ 创建了 ${testActivities.length} 个测试活动`);

    // 3. 创建参与记录 (MVP 精简版)
    console.log('👥 创建参与记录...');
    const testParticipants = await db.insert(participants).values([
      {
        activityId: testActivities[0].id,
        userId: testUsers[1].id,
        status: 'joined',
      },
      {
        activityId: testActivities[1].id,
        userId: testUsers[0].id,
        status: 'joined',
      },
      {
        activityId: testActivities[1].id,
        userId: testUsers[2].id,
        status: 'joined',
      },
    ]).returning();

    console.log(`✅ 创建了 ${testParticipants.length} 个参与记录`);

    console.log('🎉 种子数据创建完成！');
    console.log('\n📊 数据统计:');
    console.log(`- 用户: ${testUsers.length} 个`);
    console.log(`- 活动: ${testActivities.length} 个`);
    console.log(`- 参与记录: ${testParticipants.length} 个`);

  } catch (error) {
    console.error('❌ 种子数据创建失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  seed()
    .then(() => {
      console.log('✅ 种子数据脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 种子数据脚本执行失败:', error);
      process.exit(1);
    });
}

export { seed };
