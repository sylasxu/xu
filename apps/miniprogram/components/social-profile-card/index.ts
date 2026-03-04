/**
 * 社交档案卡片组件
 * Requirements: 7.0 Welcome 页结构
 * v4.4 新增
 * 
 * 展示用户社交统计数据，引导完善偏好
 */

interface SocialProfile {
  participationCount: number;
  activitiesCreatedCount: number;
  preferenceCompleteness: number;
}

interface ComponentData {
  isExpanded: boolean;
  displayProfile: SocialProfile;
  hasProfile: boolean;
  completenessText: string;
}

interface ComponentProperties {
  profile: WechatMiniprogram.Component.PropertyOption;
  collapsed: WechatMiniprogram.Component.PropertyOption;
  profileHints: WechatMiniprogram.Component.PropertyOption;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 社交档案数据
    profile: {
      type: Object,
      value: {} as any,
    },
    // 是否默认收起
    collapsed: {
      type: Boolean,
      value: false,
    },
    profileHints: {
      type: Object,
      value: {} as any,
    },
  },

  data: {
    isExpanded: true,
    displayProfile: {
      participationCount: 0,
      activitiesCreatedCount: 0,
      preferenceCompleteness: 0,
    },
    hasProfile: false,
    completenessText: '',
  },

  observers: {
    'profile, profileHints': function(profile: SocialProfile | null, profileHints: Record<string, unknown>) {
      // 检查是否有有效数据（空对象视为无数据）
      const hasValidProfile = profile && typeof profile === 'object' && 'participationCount' in profile;
      
      if (hasValidProfile) {
        const lowHint =
          typeof profileHints?.low === 'string' && profileHints.low.trim()
            ? profileHints.low.trim()
            : '完善偏好，获得更精准推荐';
        const mediumHint =
          typeof profileHints?.medium === 'string' && profileHints.medium.trim()
            ? profileHints.medium.trim()
            : '偏好已部分完善，继续补充';
        const highHint =
          typeof profileHints?.high === 'string' && profileHints.high.trim()
            ? profileHints.high.trim()
            : '偏好已完善，推荐更精准';

        let completenessText = '';
        if (profile.preferenceCompleteness < 30) {
          completenessText = lowHint;
        } else if (profile.preferenceCompleteness < 70) {
          completenessText = mediumHint;
        } else {
          completenessText = highHint;
        }
        
        this.setData({
          displayProfile: profile,
          hasProfile: true,
          completenessText,
        });
      } else {
        this.setData({
          hasProfile: false,
        });
      }
    },
    'collapsed': function(collapsed: boolean) {
      this.setData({
        isExpanded: !collapsed,
      });
    },
  },

  methods: {
    // 切换展开/收起
    onToggle() {
      this.setData({
        isExpanded: !this.data.isExpanded,
      });
    },

    // 跳转到偏好设置页
    onGoToPreference() {
      wx.navigateTo({
        url: '/subpackages/setting/preference/index',
      });
    },
  },
});
