/**
 * 社交档案卡片组件
 * Requirements: 7.0 Welcome 页结构
 * v4.4 新增
 * 
 * 展示用户社交统计数据，引导完善偏好
 */

import type { SocialProfile, WelcomeResponse } from '../../src/services/welcome';

type ProfileHints = NonNullable<WelcomeResponse['ui']>['profileHints'];

interface ComponentData {
  isExpanded: boolean;
  displayProfile: SocialProfile;
  hasProfile: boolean;
  completenessText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readSocialProfile(value: unknown): SocialProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const participationCount = readNumber(value.participationCount);
  const activitiesCreatedCount = readNumber(value.activitiesCreatedCount);
  const preferenceCompleteness = readNumber(value.preferenceCompleteness);

  if (
    participationCount === null ||
    activitiesCreatedCount === null ||
    preferenceCompleteness === null
  ) {
    return null;
  }

  return {
    participationCount,
    activitiesCreatedCount,
    preferenceCompleteness,
  };
}

function readProfileHints(value: unknown): Partial<ProfileHints> | null {
  if (!isRecord(value)) {
    return null;
  }

  const low = readString(value.low) ?? undefined;
  const medium = readString(value.medium) ?? undefined;
  const high = readString(value.high) ?? undefined;

  return { low, medium, high };
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 社交档案数据
    profile: {
      type: Object,
      value: {},
    },
    // 是否默认收起
    collapsed: {
      type: Boolean,
      value: false,
    },
    profileHints: {
      type: Object,
      value: {},
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
    'profile, profileHints': function(profile: unknown, profileHints: unknown) {
      const resolvedProfile = readSocialProfile(profile);
      const resolvedHints = readProfileHints(profileHints);
      
      if (resolvedProfile) {
        const lowHint = resolvedHints?.low || '完善偏好，获得更精准推荐';
        const mediumHint = resolvedHints?.medium || '偏好已部分完善，继续补充';
        const highHint = resolvedHints?.high || '偏好已完善，推荐更精准';

        let completenessText = '';
        if (resolvedProfile.preferenceCompleteness < 30) {
          completenessText = lowHint;
        } else if (resolvedProfile.preferenceCompleteness < 70) {
          completenessText = mediumHint;
        } else {
          completenessText = highHint;
        }
        
        this.setData({
          displayProfile: resolvedProfile,
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
