/**
 * 偏好设置页面
 * Requirements: 7.2 偏好设置页
 * v4.4 新增
 * 
 * 用户可以设置活动类型、时间偏好、常去地点、社交偏好
 * 数据保存到 users.workingMemory 字段
 */
import { useUserStore } from '../../../src/stores/user';

// 偏好选项类型
interface PreferenceOption {
  value: string;
  label: string;
  icon?: string;
  selected: boolean;
}

// 页面数据类型
interface PageData {
  // 活动类型偏好
  activityTypes: PreferenceOption[];
  // 时间偏好
  timePreferences: PreferenceOption[];
  // 常去地点
  frequentLocations: PreferenceOption[];
  // 社交偏好
  socialPreferences: PreferenceOption[];
  // 自定义地点输入
  customLocation: string;
  // 加载状态
  isLoading: boolean;
  isSaving: boolean;
}

function parseWorkingMemory(rawValue?: string | null): {
  preferences?: Array<{ category: string; value: string; sentiment: string }>;
  frequentLocations?: string[];
} | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const preferences = Array.isArray(record.preferences)
      ? record.preferences
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const preference = item as Record<string, unknown>;
            if (
              typeof preference.category !== 'string' ||
              typeof preference.value !== 'string' ||
              typeof preference.sentiment !== 'string'
            ) {
              return null;
            }

            return {
              category: preference.category,
              value: preference.value,
              sentiment: preference.sentiment,
            };
          })
          .filter((item): item is { category: string; value: string; sentiment: string } => item !== null)
      : undefined;

    const frequentLocations = Array.isArray(record.frequentLocations)
      ? record.frequentLocations.filter((item): item is string => typeof item === 'string')
      : undefined;

    return {
      ...(preferences ? { preferences } : {}),
      ...(frequentLocations ? { frequentLocations } : {}),
    };
  } catch (error) {
    console.error('解析 workingMemory 失败:', error);
    return null;
  }
}

Page<PageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    activityTypes: [
      { value: 'food', label: '火锅', icon: '🍲', selected: false },
      { value: 'sports', label: '运动', icon: '🏃', selected: false },
      { value: 'boardgame', label: '桌游', icon: '🎲', selected: false },
      { value: 'entertainment', label: 'KTV', icon: '🎤', selected: false },
      { value: 'outdoor', label: '户外', icon: '⛰️', selected: false },
      { value: 'coffee', label: '咖啡', icon: '☕', selected: false },
    ],
    timePreferences: [
      { value: 'weekday_evening', label: '工作日晚', selected: false },
      { value: 'weekend_day', label: '周末白天', selected: false },
      { value: 'weekend_evening', label: '周末晚上', selected: false },
      { value: 'anytime', label: '随时都行', selected: false },
    ],
    frequentLocations: [
      { value: '观音桥', label: '观音桥', selected: false },
      { value: '解放碑', label: '解放碑', selected: false },
      { value: '南坪', label: '南坪', selected: false },
      { value: '沙坪坝', label: '沙坪坝', selected: false },
    ],
    socialPreferences: [
      { value: 'small', label: '小规模(≤4人)', selected: false },
      { value: 'medium', label: '中等(5-8人)', selected: false },
      { value: 'large', label: '大型(>8人)', selected: false },
    ],
    customLocation: '',
    isLoading: true,
    isSaving: false,
  },

  onLoad() {
    this.loadPreferences();
  },

  /**
   * 加载用户偏好
   */
  async loadPreferences() {
    const userStore = useUserStore.getState();
    const user = userStore.user;
    
    if (!user) {
      this.setData({ isLoading: false });
      return;
    }

    // 从 workingMemory 中提取偏好
    const workingMemory = parseWorkingMemory(user.workingMemory);

    if (workingMemory) {
      const { activityTypes, timePreferences, frequentLocations, socialPreferences } = this.data;
      
      // 更新活动类型选中状态
      const likedActivities = (workingMemory.preferences || [])
        .filter(p => p.category === 'activity_type' && p.sentiment === 'like')
        .map(p => p.value);
      
      const updatedActivityTypes = activityTypes.map(item => ({
        ...item,
        selected: likedActivities.includes(item.label),
      }));

      // 更新时间偏好选中状态
      const likedTimes = (workingMemory.preferences || [])
        .filter(p => p.category === 'time' && p.sentiment === 'like')
        .map(p => p.value);
      
      const updatedTimePreferences = timePreferences.map(item => ({
        ...item,
        selected: likedTimes.includes(item.label),
      }));

      // 更新常去地点选中状态
      const savedLocations = workingMemory.frequentLocations || [];
      const updatedFrequentLocations = frequentLocations.map(item => ({
        ...item,
        selected: savedLocations.includes(item.value),
      }));

      // 更新社交偏好选中状态
      const likedSocial = (workingMemory.preferences || [])
        .filter(p => p.category === 'social' && p.sentiment === 'like')
        .map(p => p.value);
      
      const updatedSocialPreferences = socialPreferences.map(item => ({
        ...item,
        selected: likedSocial.includes(item.label),
      }));

      this.setData({
        activityTypes: updatedActivityTypes,
        timePreferences: updatedTimePreferences,
        frequentLocations: updatedFrequentLocations,
        socialPreferences: updatedSocialPreferences,
        isLoading: false,
      });
    } else {
      this.setData({ isLoading: false });
    }
  },

  /**
   * 切换活动类型选中状态
   */
  onActivityTypeToggle(e: WechatMiniprogram.TouchEvent) {
    const { index } = e.currentTarget.dataset;
    const { activityTypes } = this.data;
    activityTypes[index].selected = !activityTypes[index].selected;
    this.setData({ activityTypes });
  },

  /**
   * 切换时间偏好选中状态
   */
  onTimePreferenceToggle(e: WechatMiniprogram.TouchEvent) {
    const { index } = e.currentTarget.dataset;
    const { timePreferences } = this.data;
    timePreferences[index].selected = !timePreferences[index].selected;
    this.setData({ timePreferences });
  },

  /**
   * 切换常去地点选中状态
   */
  onLocationToggle(e: WechatMiniprogram.TouchEvent) {
    const { index } = e.currentTarget.dataset;
    const { frequentLocations } = this.data;
    frequentLocations[index].selected = !frequentLocations[index].selected;
    this.setData({ frequentLocations });
  },

  /**
   * 切换社交偏好选中状态
   */
  onSocialPreferenceToggle(e: WechatMiniprogram.TouchEvent) {
    const { index } = e.currentTarget.dataset;
    const { socialPreferences } = this.data;
    socialPreferences[index].selected = !socialPreferences[index].selected;
    this.setData({ socialPreferences });
  },

  /**
   * 自定义地点输入
   */
  onCustomLocationInput(e: WechatMiniprogram.Input) {
    this.setData({ customLocation: e.detail.value });
  },

  /**
   * 添加自定义地点
   */
  onAddCustomLocation() {
    const { customLocation, frequentLocations } = this.data;
    if (!customLocation.trim()) return;
    
    // 检查是否已存在
    if (frequentLocations.some(l => l.value === customLocation.trim())) {
      wx.showToast({ title: '地点已存在', icon: 'none' });
      return;
    }

    frequentLocations.push({
      value: customLocation.trim(),
      label: customLocation.trim(),
      selected: true,
    });

    this.setData({
      frequentLocations,
      customLocation: '',
    });
  },

  /**
   * 保存偏好
   */
  async onSave() {
    const userStore = useUserStore.getState();
    const user = userStore.user;
    
    if (!user) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    this.setData({ isSaving: true });

    try {
      const { activityTypes, timePreferences, frequentLocations, socialPreferences } = this.data;
      
      // 构建 workingMemory
      const preferences: Array<{
        category: string;
        sentiment: string;
        value: string;
        confidence: number;
        updatedAt: string;
      }> = [];

      // 活动类型偏好
      activityTypes.filter(t => t.selected).forEach(t => {
        preferences.push({
          category: 'activity_type',
          sentiment: 'like',
          value: t.label,
          confidence: 1,
          updatedAt: new Date().toISOString(),
        });
      });

      // 时间偏好
      timePreferences.filter(t => t.selected).forEach(t => {
        preferences.push({
          category: 'time',
          sentiment: 'like',
          value: t.label,
          confidence: 1,
          updatedAt: new Date().toISOString(),
        });
      });

      // 社交偏好
      socialPreferences.filter(s => s.selected).forEach(s => {
        preferences.push({
          category: 'social',
          sentiment: 'like',
          value: s.label,
          confidence: 1,
          updatedAt: new Date().toISOString(),
        });
      });

      // 常去地点
      const selectedLocations = frequentLocations
        .filter(l => l.selected)
        .map(l => l.value);

      const workingMemory = {
        version: 2,
        preferences,
        frequentLocations: selectedLocations,
        lastUpdated: new Date().toISOString(),
      };

      // 调用 API 更新用户信息
      await userStore.updateProfile({
        workingMemory: JSON.stringify(workingMemory),
      });

      wx.showToast({ title: '保存成功', icon: 'success' });
      
      // 返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (error) {
      console.error('保存偏好失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ isSaving: false });
    }
  },
});
