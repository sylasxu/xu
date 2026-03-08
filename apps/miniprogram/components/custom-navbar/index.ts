/**
 * 自定义导航栏组件
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 14.2, 14.3
 * 
 * Chat-First 架构的顶部导航栏
 * - 左侧：Menu 图标（跳转个人中心）或返回按钮
 * - 中间：品牌词"聚场"或自定义标题
 * - 右侧：More 图标（显示下拉菜单）
 */

interface ComponentData {
  statusBarHeight: number;
  navBarHeight: number;
  menuButtonInfo: WechatMiniprogram.ClientRect | null;
  showDropmenu: boolean;
}

interface ComponentProperties {
  title: WechatMiniprogram.Component.PropertyOption;
  showMenu: WechatMiniprogram.Component.PropertyOption;
  showMore: WechatMiniprogram.Component.PropertyOption;
  showBack: WechatMiniprogram.Component.PropertyOption;
  transparent: WechatMiniprogram.Component.PropertyOption;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
    multipleSlots: true,
  },

  properties: {
    // 标题文字，默认"聚场"
    title: {
      type: String,
      value: '聚场',
    },
    // 是否显示左侧 Menu 图标
    showMenu: {
      type: Boolean,
      value: true,
    },
    // 是否显示右侧 More 图标
    showMore: {
      type: Boolean,
      value: true,
    },
    // 是否显示返回按钮（优先级高于 showMenu）
    showBack: {
      type: Boolean,
      value: false,
    },
    // 是否透明背景
    transparent: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    statusBarHeight: 0,
    navBarHeight: 44,
    menuButtonInfo: null as WechatMiniprogram.ClientRect | null,
    showDropmenu: false,
  },

  lifetimes: {
    attached() {
      this.initNavBarInfo();
    },
  },

  methods: {
    /**
     * 初始化导航栏信息
     * 获取状态栏高度和胶囊按钮位置，计算导航栏高度
     */
    initNavBarInfo() {
      try {
        const systemInfo = wx.getSystemInfoSync();
        const statusBarHeight = systemInfo.statusBarHeight || 20;
        
        // 获取胶囊按钮位置信息
        const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
        
        // 计算导航栏高度：(胶囊顶部 - 状态栏高度) * 2 + 胶囊高度
        const navBarHeight = (menuButtonInfo.top - statusBarHeight) * 2 + menuButtonInfo.height;
        
        this.setData({
          statusBarHeight,
          navBarHeight,
          menuButtonInfo,
        });
      } catch (error) {
        console.error('获取导航栏信息失败', error);
        // 使用默认值
        this.setData({
          statusBarHeight: 20,
          navBarHeight: 44,
        });
      }
    },

    /**
     * 点击左侧 Menu 图标
     * Requirements: 2.4 - 跳转到个人中心
     */
    onMenuTap() {
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      wx.navigateTo({
        url: '/pages/profile/index',
        fail: () => {
          // 如果 navigateTo 失败，尝试 switchTab
          wx.switchTab({
            url: '/pages/profile/index',
          });
        },
      });
      
      this.triggerEvent('menutap');
    },

    /**
     * 点击返回按钮
     * Requirements: 14.2, 14.3 - 页面栈判断
     */
    onBackTap() {
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      const pages = getCurrentPages();
      
      if (pages.length > 1) {
        // 页面栈长度大于 1，正常返回
        wx.navigateBack();
      } else {
        // 页面栈长度为 1（单点进入），跳转首页
        wx.reLaunch({
          url: '/pages/home/index',
        });
      }
      
      this.triggerEvent('back');
    },

    /**
     * 点击右侧 More 图标
     * Requirements: 2.5 - 显示下拉菜单
     */
    onMoreTap() {
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      this.setData({
        showDropmenu: !this.data.showDropmenu,
      });
      
      this.triggerEvent('moretap', { visible: this.data.showDropmenu });
    },

    /**
     * 关闭下拉菜单
     */
    closeDropmenu() {
      if (this.data.showDropmenu) {
        this.setData({ showDropmenu: false });
        this.triggerEvent('dropmenuclose');
      }
    },

    /**
     * 下拉菜单项点击
     */
    onDropmenuItemTap(e: WechatMiniprogram.TouchEvent) {
      const { action } = e.currentTarget.dataset;
      
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      this.closeDropmenu();
      
      if (action === 'message') {
        // Requirements: 2.7 - 跳转消息中心
        wx.navigateTo({
          url: '/pages/message/index',
        });
      } else if (action === 'newchat') {
        // Requirements: 2.8 - 新对话
        this.triggerEvent('newchat');
      }
    },

    /**
     * 点击遮罩层关闭下拉菜单
     */
    onOverlayTap() {
      this.closeDropmenu();
    },
  },
});
