/**
 * Widget Draft 组件
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 * v3.4 新增: 多轮对话支持
 * 
 * 意图解析卡片 (v3.5 零成本地图方案)
 * - 显示 AI 预填的标题、时间、地点、类型
 * - 使用位置文字卡片替代静态地图（零成本）
 * - 点击位置卡片打开原生地图导航
 * - 实现 [📍 调整位置] 按钮（使用 wx.chooseLocation）
 * - 实现 [✅ 确认发布] 按钮
 * - v5.2: 快捷操作直接发送结构化动作（edit_draft/save_draft_settings/confirm_publish）
 */

import { chooseLocation, openMapNavigation } from '../../src/config/index';
import { useChatStore } from '../../src/stores/chat';

// 活动类型映射
const TYPE_CONFIG: Record<string, { icon: string; label: string; colorClass: string }> = {
  food: { icon: 'shop', label: '美食', colorClass: 'amber' },
  entertainment: { icon: 'film', label: '娱乐', colorClass: 'purple' },
  sports: { icon: 'heart', label: '运动', colorClass: 'mint' },
  boardgame: { icon: 'app', label: '桌游', colorClass: 'blue' },
  mahjong: { icon: 'app', label: '麻将', colorClass: 'amber' },
  hotpot: { icon: 'shop', label: '火锅', colorClass: 'amber' },
  ktv: { icon: 'sound', label: 'KTV', colorClass: 'purple' },
  movie: { icon: 'film', label: '电影', colorClass: 'purple' },
  game: { icon: 'app', label: '游戏', colorClass: 'purple' },
  drink: { icon: 'shop', label: '喝酒', colorClass: 'amber' },
  coffee: { icon: 'shop', label: '咖啡', colorClass: 'amber' },
  hiking: { icon: 'location', label: '徒步', colorClass: 'mint' },
  other: { icon: 'ellipsis', label: '其他', colorClass: 'blue' },
};

const ACTION_TYPE_MAP: Record<string, string> = {
  food: '美食',
  entertainment: '娱乐',
  sports: '运动',
  boardgame: '桌游',
  ktv: 'K歌',
  other: '其他',
};

// 草稿数据类型
interface DraftData {
  activityId: string;
  title: string;
  description?: string;
  type: string;
  startAt: string;
  location: [number, number]; // [lng, lat]
  locationName: string;
  address?: string;
  locationHint: string;
  maxParticipants: number;
  currentParticipants?: number;
}

const DEFAULT_LOCATION: [number, number] = [106.52988, 29.58567]
const INITIAL_DRAFT: DraftData = {
  activityId: '',
  title: '',
  type: 'other',
  startAt: '',
  location: DEFAULT_LOCATION,
  locationName: '',
  locationHint: '',
  maxParticipants: 4,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readLocation(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }

  const lng = readNumber(value[0])
  const lat = readNumber(value[1])
  if (lng === null || lat === null) {
    return null
  }

  return [lng, lat]
}

function readDraftData(value: unknown): DraftData | null {
  if (!isRecord(value)) {
    return null
  }

  const activityId = readText(value.activityId)
  const title = readText(value.title)
  const type = readText(value.type)
  const startAt = readText(value.startAt)
  const location = readLocation(value.location)
  const locationName = readText(value.locationName)
  const locationHint = readText(value.locationHint)
  const maxParticipants = readNumber(value.maxParticipants)

  if (!activityId || !title || !type || !startAt || !location || !locationName || !locationHint || maxParticipants === null) {
    return null
  }

  const description = readText(value.description) || undefined
  const address = readText(value.address) || undefined
  const currentParticipants = readNumber(value.currentParticipants) ?? undefined

  return {
    activityId,
    title,
    ...(description ? { description } : {}),
    type,
    startAt,
    location,
    locationName,
    ...(address ? { address } : {}),
    locationHint,
    maxParticipants,
    ...(currentParticipants !== undefined ? { currentParticipants } : {}),
  }
}

function resolveSlotFromStartAt(startAt: string): string {
  if (!startAt) {
    return 'fri_20_00';
  }

  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) {
    return 'fri_20_00';
  }

  const hour = date.getHours();
  if (hour <= 19) {
    return 'fri_19_00';
  }

  if (hour >= 21) {
    return 'fri_21_00';
  }

  return 'fri_20_00';
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 草稿数据
    draft: {
      type: Object,
      value: INITIAL_DRAFT,
    },
    // 是否正在加载
    loading: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    typeIcon: 'ellipsis',
    typeLabel: '活动',
    colorClass: 'blue',
    formattedTime: '',
    isExpired: false,
  },

  observers: {
    'draft': function(draft: unknown) {
      const resolvedDraft = readDraftData(draft)
      if (!resolvedDraft) return;
      
      // 更新类型信息
      const typeConfig = TYPE_CONFIG[resolvedDraft.type] || TYPE_CONFIG.other;
      
      // 格式化时间
      const formattedTime = this.formatTime(resolvedDraft.startAt);
      
      // 检查是否过期
      const isExpired = this.checkExpired(resolvedDraft.startAt);
      
      this.setData({
        typeIcon: typeConfig.icon,
        typeLabel: typeConfig.label,
        colorClass: typeConfig.colorClass,
        formattedTime,
        isExpired,
      });
    },
  },

  methods: {
    /**
     * 格式化时间
     * Requirements: 6.2
     */
    formatTime(dateStr: string): string {
      if (!dateStr) return '';
      
      const date = new Date(dateStr);
      const now = new Date();
      
      // 判断是否是今天
      const isToday = date.toDateString() === now.toDateString();
      
      // 判断是否是明天
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      // 格式化时间
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      
      if (isToday) {
        return `今天 ${timeStr}`;
      }
      
      if (isTomorrow) {
        return `明天 ${timeStr}`;
      }
      
      // 判断是否是本周
      const dayOfWeek = date.getDay();
      const daysUntil = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntil > 0 && daysUntil < 7) {
        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return `${weekDays[dayOfWeek]} ${timeStr}`;
      }
      
      // 其他日期
      const month = date.getMonth() + 1;
      const day = date.getDate();
      return `${month}月${day}日 ${timeStr}`;
    },

    /**
     * 检查是否过期
     * Requirements: 6.8
     */
    checkExpired(dateStr: string): boolean {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date.getTime() < Date.now();
    },

    toActionActivityType(draftType: string): string {
      return ACTION_TYPE_MAP[draftType] || draftType || '桌游';
    },

    buildDraftActionPayload(draft: DraftData, overrides?: Record<string, unknown>): Record<string, unknown> {
      const [lng, lat] = Array.isArray(draft.location) ? draft.location : [106.52988, 29.58567];
      const basePayload: Record<string, unknown> = {
        activityId: draft.activityId,
        title: draft.title,
        type: draft.type || 'other',
        activityType: this.toActionActivityType(draft.type),
        startAt: draft.startAt,
        locationName: draft.locationName,
        locationHint: draft.locationHint || draft.address || `${draft.locationName || '观音桥'}商圈`,
        slot: resolveSlotFromStartAt(draft.startAt),
        maxParticipants: draft.maxParticipants || 6,
        currentParticipants: draft.currentParticipants || 1,
        lat,
        lng,
      };

      return {
        ...basePayload,
        ...(overrides || {}),
      };
    },

    dispatchDraftAction(action: string, payload: Record<string, unknown>, originalText: string): void {
      const chatStore = useChatStore.getState();
      chatStore.sendAction({
        action,
        payload,
        source: 'widget_draft',
        originalText,
      });
    },

    /**
     * 点击位置卡片 - 打开原生地图导航
     * Requirements: 6.4 (零成本方案)
     */
    onLocationTap() {
      const draft = readDraftData(this.properties.draft);
      if (!draft?.location) return;
      
      const [lng, lat] = draft.location;
      
      // 使用微信原生 API 打开地图
      openMapNavigation({
        latitude: lat,
        longitude: lng,
        name: draft.locationName,
        address: draft.address || draft.locationHint,
      });
    },

    /**
     * 点击调整位置 - 使用 wx.chooseLocation
     * Requirements: 6.5 (零成本方案)
     */
    async onAdjustLocation() {
      const draft = readDraftData(this.properties.draft);
      if (!draft) return;
      
      try {
        // 使用微信原生选点 API，无需 Key
        const result = await chooseLocation();
        
        // 触发位置更新事件
        this.triggerEvent('locationchange', {
          draft,
          newLocation: {
            latitude: result.latitude,
            longitude: result.longitude,
            locationName: result.name,
            address: result.address,
          },
        });

        const payload = this.buildDraftActionPayload(draft, {
          location: result.name || draft.locationName,
          locationName: result.name || draft.locationName,
          locationHint: result.address || result.name || draft.locationHint,
          lat: result.latitude,
          lng: result.longitude,
        });

        this.dispatchDraftAction(
          'save_draft_settings',
          payload,
          `位置改为${result.name || '新地点'}`
        );
      } catch (err: unknown) {
        // 用户取消不提示
        if (!(err instanceof Error) || !err.message.includes('取消')) {
          wx.showToast({
            title: err instanceof Error ? err.message : '选择位置失败',
            icon: 'none',
          });
        }
      }
    },

    /**
     * 点击确认发布
     * Requirements: 6.7, 6.8
     */
    onConfirm() {
      const draft = readDraftData(this.properties.draft);
      if (!draft) return;
      
      // 检查是否过期
      if (this.data.isExpired) {
        wx.showToast({
          title: '活动时间已过期，请修改时间',
          icon: 'none',
        });
        return;
      }

      this.triggerEvent('confirm', { draft });
      this.dispatchDraftAction('confirm_publish', this.buildDraftActionPayload(draft), '确认发布');
    },

    /**
     * 点击换地方按钮（结构化动作）
     */
    onChangeLocation() {
      const draft = readDraftData(this.properties.draft);
      if (!draft?.activityId) return;

      this.dispatchDraftAction('edit_draft', this.buildDraftActionPayload(draft, { field: 'location' }), '改下地点');
    },

    /**
     * 点击换时间按钮（结构化动作）
     */
    onChangeTime() {
      const draft = readDraftData(this.properties.draft);
      if (!draft?.activityId) return;

      this.dispatchDraftAction('edit_draft', this.buildDraftActionPayload(draft, { field: 'time' }), '改下时间');
    },

    /**
     * 点击加人按钮（结构化动作）
     */
    onChangeParticipants() {
      const draft = readDraftData(this.properties.draft);
      if (!draft?.activityId) return;

      this.dispatchDraftAction('edit_draft', this.buildDraftActionPayload(draft, { field: 'participants' }), '改下人数设置');
    },
  },
});
