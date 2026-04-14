/**
 * 设置页面
 */

interface SettingItem {
  title: string;
  key: string;
  type: 'switch' | 'action' | 'link';
  value?: boolean;
}

interface SettingGroup {
  title: string;
  items: SettingItem[];
}

interface PageData {
  menuData: SettingGroup[];
  isLoggedIn: boolean;
}

Page({
  data: {
    menuData: [
      {
        title: '通知设置',
        items: [
          {
            title: '活动提醒',
            key: 'activityRemind',
            type: 'switch',
            value: true,
          },
          {
            title: '消息通知',
            key: 'messageNotify',
            type: 'switch',
            value: true,
          },
        ],
      },
      {
        title: '隐私设置',
        items: [
          {
            title: '显示在线状态',
            key: 'showOnline',
            type: 'switch',
            value: true,
          },
          {
            title: '允许陌生人查看资料',
            key: 'allowStranger',
            type: 'switch',
            value: false,
          },
        ],
      },
      {
        title: '偏好线索',
        items: [
          {
            title: '我的偏好整理',
            key: 'preferenceInsight',
            type: 'action',
          },
        ],
      },
      {
        title: '其他',
        items: [
          {
            title: '清除缓存',
            key: 'clearCache',
            type: 'action',
          },
          {
            title: '关于我们',
            key: 'about',
            type: 'link',
          },
        ],
      },
    ] as SettingGroup[],
    isLoggedIn: false,
  },

  onLoad() {
    this.checkLoginStatus();
    this.loadSettings();
  },

  onShow() {
    this.checkLoginStatus();
  },

  /**
   * 检查登录状态
   */
  checkLoginStatus() {
    const token = wx.getStorageSync('token');
    this.setData({ isLoggedIn: !!token });
  },

  /**
   * 加载设置
   */
  loadSettings() {
    const settings = wx.getStorageSync('app_settings') as Record<string, boolean> || {};
    const menuData = [...this.data.menuData];

    menuData.forEach((group) => {
      group.items.forEach((item) => {
        if (item.type === 'switch' && settings[item.key] !== undefined) {
          item.value = settings[item.key];
        }
      });
    });

    this.setData({ menuData });
  },

  /**
   * 保存设置
   */
  saveSettings() {
    const settings: Record<string, boolean> = {};
    this.data.menuData.forEach((group) => {
      group.items.forEach((item) => {
        if (item.type === 'switch' && item.value !== undefined) {
          settings[item.key] = item.value;
        }
      });
    });
    wx.setStorageSync('app_settings', settings);
  },

  /**
   * 开关切换
   */
  handleSwitchChange(e: WechatMiniprogram.CustomEvent) {
    const { groupIndex, itemIndex } = e.currentTarget.dataset;
    const { value } = e.detail;

    const key = `menuData[${groupIndex}].items[${itemIndex}].value`;
    this.setData({ [key]: value });
    this.saveSettings();
  },

  /**
   * 点击操作项
   */
  handleItemTap(e: WechatMiniprogram.CustomEvent) {
    const { key, type } = e.currentTarget.dataset;

    if (type === 'switch') return;

    switch (key) {
      case 'preferenceInsight':
        this.showPreferenceInsight();
        break;
      case 'clearCache':
        this.clearCache();
        break;
      case 'about':
        this.showAbout();
        break;
    }
  },

  /**
   * 偏好线索说明
   */
  showPreferenceInsight() {
    wx.showModal({
      title: '偏好线索',
      content: '你的活动偏好、常去地点和常用表达，会在对话和真实参与结果里慢慢被我记住，不用单独填一大张表。',
      showCancel: false,
    });
  },

  /**
   * 清除缓存
   */
  clearCache() {
    wx.showModal({
      title: '提示',
      content: '确认清除所有缓存数据？',
      success: (res) => {
        if (res.confirm) {
          // 保留登录信息
          const token = wx.getStorageSync('token');
          const userInfo = wx.getStorageSync('userInfo');

          wx.clearStorageSync();

          if (token) wx.setStorageSync('token', token);
          if (userInfo) wx.setStorageSync('userInfo', userInfo);

          wx.showToast({ title: '缓存已清除', icon: 'success' });
        }
      },
    });
  },

  /**
   * 关于我们
   */
  showAbout() {
    wx.showModal({
      title: '关于 xu',
      content: 'xu - 碎片化社交助理\n版本: 1.0.0\n\n帮你把想玩的事张罗起来',
      showCancel: false,
    });
  },

  /**
   * 退出登录
   */
  handleLogout() {
    wx.showModal({
      title: '提示',
      content: '确认退出登录？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          this.setData({ isLoggedIn: false });
          wx.showToast({ title: '已退出登录', icon: 'success' });

          // 返回首页
          setTimeout(() => {
            wx.switchTab({ url: '/pages/chat/index' });
          }, 1500);
        }
      },
    });
  },
});
