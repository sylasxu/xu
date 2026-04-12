/**
 * 聚场小程序入口
 * Requirements: 15.3 - 解析启动scene参数，直接跳转活动详情
 */
import createBus from './utils/eventBus';

interface GlobalData {
  userInfo: {
    id: string;
    nickname: string;
    avatarUrl: string;
  } | null;
  unreadNum: number;
  socket: WechatMiniprogram.SocketTask | null;
}

interface AppInstance {
  globalData: GlobalData;
  eventBus: ReturnType<typeof createBus>;
  setUnreadNum(unreadNum: number): void;
  handleSceneParams(options: LaunchOptions): void;
}

interface LaunchOptions {
  path: string;
  query: Record<string, string>;
  scene: number;
  referrerInfo?: {
    appId: string;
    extraData?: Record<string, unknown>;
  };
}

function readActivityIdFromScene(rawScene: string): string | null {
  const pairs = decodeURIComponent(rawScene)
    .split('&')
    .map((segment) => segment.trim())
    .filter(Boolean)

  for (const pair of pairs) {
    const [rawKey, ...rawValueParts] = pair.split('=')
    const key = rawKey ? rawKey.trim() : ''
    const value = rawValueParts.join('=').trim()

    if ((key === 'id' || key === 'activityId') && value) {
      return value
    }
  }

  return null
}

App<AppInstance>({
  onLaunch(options: LaunchOptions) {
    // 版本更新检查
    const updateManager = wx.getUpdateManager();

    updateManager.onCheckForUpdate(() => {
      // 检查更新
    });

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已经准备好，是否重启应用？',
        success(res) {
          if (res.confirm) {
            updateManager.applyUpdate();
          }
        },
      });
    });

    // 处理场景参数 (Requirements: 15.3)
    this.handleSceneParams(options);
  },

  globalData: {
    userInfo: null,
    unreadNum: 0,
    socket: null,
  },

  /** 全局事件总线 */
  eventBus: createBus(),

  /**
   * 处理场景参数 (Requirements: 15.3)
   * 解析启动scene参数，直接跳转活动详情
   */
  handleSceneParams(options: LaunchOptions) {
    const { query } = options;

    // 场景值说明：
    // 1007 - 单人聊天会话中的小程序消息卡片
    // 1008 - 群聊会话中的小程序消息卡片
    // 1011 - 扫描二维码
    // 1047 - 扫描小程序码

    // 如果有活动ID参数，跳转到活动详情
    if (query.id || query.activityId) {
      const activityId = query.id || query.activityId;

      // 延迟跳转，确保首页加载完成
      setTimeout(() => {
        wx.navigateTo({
          url: `/subpackages/activity/detail/index?id=${activityId}`,
          fail: () => {
            wx.reLaunch({
              url: `/subpackages/activity/detail/index?id=${activityId}`,
            });
          },
        });
      }, 500);
    }

    // 处理分享场景
    if (query.scene) {
      try {
        const activityId = readActivityIdFromScene(query.scene);

        if (activityId) {
          setTimeout(() => {
            wx.navigateTo({
              url: `/subpackages/activity/detail/index?id=${activityId}`,
              fail: () => {
                wx.reLaunch({
                  url: `/subpackages/activity/detail/index?id=${activityId}`,
                });
              },
            });
          }, 500);
        }
      } catch (error) {
        console.error('解析 scene 参数失败', error);
      }
    }
  },

  /** 设置未读消息数量 */
  setUnreadNum(unreadNum: number) {
    this.globalData.unreadNum = unreadNum;
    this.eventBus.emit('unread-num-change', unreadNum);
  },
});
