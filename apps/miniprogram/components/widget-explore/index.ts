/**
 * Widget Explore 组件 (Generative UI)
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 * Enhanced: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4, 5.5, 7.2, 7.3, 7.5
 *
 * 探索卡片 — 支持自包含模式和引用模式
 * - 自包含模式：直接渲染 results（现有行为不变）
 * - 引用模式：通过 fetchConfig 拉取数据，支持 Swiper、半屏详情、卡内操作
 */

import { useChatStore } from '../../src/stores/chat';
import { useAppStore } from '../../src/stores/app';
import { useUserStore } from '../../src/stores/user';
import { fetchWidgetData } from '../../src/utils/widget-fetcher';
import type { FetchState, WidgetDataSource } from '../../src/utils/widget-fetcher';
import type { ActionState, WidgetAction } from '../../src/utils/widget-actions';
import { submitJoinAndOpenDiscussion, type JoinFlowPayload } from '../../src/utils/join-flow';

// 探索结果类型
interface ExploreResult {
  id: string;
  title: string;
  type: string;
  lat: number;
  lng: number;
  locationName: string;
  locationHint?: string;
  distance: number;
  startAt: string;
  currentParticipants?: number;
  maxParticipants?: number;
}

// 中心点类型
interface CenterPoint {
  lat: number;
  lng: number;
  name: string;
}

// 预览数据
interface PreviewData {
  total: number;
  firstItem: {
    id: string;
    title: string;
    type: string;
    locationName: string;
    distance: number;
  };
}

// FetchConfig
interface FetchConfig {
  source: WidgetDataSource;
  params: Record<string, unknown>;
}

// Interaction
interface Interaction {
  swipeable?: boolean;
  halfScreenDetail?: boolean;
  actions?: WidgetAction[];
}

interface WidgetExploreProperties {
  results?: ExploreResult[];
  center?: CenterPoint;
  title?: string;
  semanticQuery?: string;
  fetchConfig?: FetchConfig;
  interaction?: Interaction;
  preview?: PreviewData;
}

const DEFAULT_CENTER: CenterPoint = {
  lat: 29.5647,
  lng: 106.5507,
  name: '观音桥',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readExploreResult(value: unknown): ExploreResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const title = readString(value.title);
  const type = readString(value.type);
  const lat = readNumber(value.lat);
  const lng = readNumber(value.lng);
  const locationName = readString(value.locationName);
  const distance = readNumber(value.distance);
  const startAt = readString(value.startAt);

  if (!id || !title || !type || lat === null || lng === null || !locationName || distance === null || !startAt) {
    return null;
  }

  const locationHint = readString(value.locationHint) ?? undefined;
  const currentParticipants = readNumber(value.currentParticipants) ?? undefined;
  const maxParticipants = readNumber(value.maxParticipants) ?? undefined;

  return {
    id,
    title,
    type,
    lat,
    lng,
    locationName,
    locationHint,
    distance,
    startAt,
    currentParticipants,
    maxParticipants,
  };
}

function readExploreResults(value: unknown): ExploreResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => readExploreResult(item))
    .filter((item): item is ExploreResult => item !== null);
}

function readCenterPoint(value: unknown): CenterPoint {
  if (!isRecord(value)) {
    return DEFAULT_CENTER;
  }

  const lat = readNumber(value.lat);
  const lng = readNumber(value.lng);
  const name = readString(value.name);

  if (lat === null || lng === null) {
    return DEFAULT_CENTER;
  }

  return {
    lat,
    lng,
    name: name ?? DEFAULT_CENTER.name,
  };
}

function readPreviewData(value: unknown): PreviewData | null {
  if (!isRecord(value)) {
    return null;
  }

  const total = readNumber(value.total);
  const firstItem = isRecord(value.firstItem) ? value.firstItem : null;
  if (total === null || !firstItem) {
    return null;
  }

  const id = readString(firstItem.id);
  const title = readString(firstItem.title);
  const type = readString(firstItem.type);
  const locationName = readString(firstItem.locationName);
  const distance = readNumber(firstItem.distance);

  if (!id || !title || !type || !locationName || distance === null) {
    return null;
  }

  return {
    total,
    firstItem: {
      id,
      title,
      type,
      locationName,
      distance,
    },
  };
}

function readWidgetDataSource(value: unknown): WidgetDataSource | null {
  switch (value) {
    case 'nearby_activities':
    case 'activity_detail':
      return value;
    default:
      return null;
  }
}

function readFetchConfig(value: unknown): FetchConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const source = readWidgetDataSource(value.source);
  const params = isRecord(value.params) ? value.params : null;
  if (!source || !params) {
    return null;
  }

  return { source, params };
}

function readWidgetAction(value: unknown): WidgetAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = readString(value.label);
  const params = isRecord(value.params) ? value.params : {};

  switch (value.type) {
    case 'join':
    case 'cancel':
    case 'share':
    case 'detail':
    case 'publish':
    case 'confirm_match':
      if (!label) {
        return null;
      }
      return {
        type: value.type,
        label,
        params,
      };
    default:
      return null;
  }
}

function readInteraction(value: unknown): Interaction | null {
  if (!isRecord(value)) {
    return null;
  }

  const swipeable = readBoolean(value.swipeable);
  const halfScreenDetail = readBoolean(value.halfScreenDetail);
  const actions = Array.isArray(value.actions)
    ? value.actions
        .map((item) => readWidgetAction(item))
        .filter((item): item is WidgetAction => item !== null)
    : undefined;

  return {
    swipeable,
    halfScreenDetail,
    actions,
  };
}

function readJoinPayload(value: Record<string, unknown>): JoinFlowPayload | null {
  const activityId = readString(value.activityId);
  if (!activityId) {
    return null;
  }

  const payload: JoinFlowPayload = { activityId };
  const title = readString(value.title);
  const startAt = readString(value.startAt);
  const locationName = readString(value.locationName);

  if (title) {
    payload.title = title;
  }
  if (startAt) {
    payload.startAt = startAt;
  }
  if (locationName) {
    payload.locationName = locationName;
  }

  return payload;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 现有（不变）
    results: { type: Array, value: [] },
    center: {
      type: Object,
      value: DEFAULT_CENTER,
    },
    title: { type: String, value: '' },
    semanticQuery: { type: String, value: '' },
    // 引用模式新增
    fetchConfig: { type: Object, value: undefined },
    interaction: { type: Object, value: undefined },
    preview: { type: Object, value: undefined },
  },

  data: {
    displayResults: [] as ExploreResult[],
    headerTitle: '',
    // 引用模式
    fetchState: 'idle' as FetchState,
    fetchedResults: [] as ExploreResult[],
    swiperMode: false,
    activeIndex: 0,
    // 操作状态 { [activityId_actionType]: ActionState }
    actionStates: {} as Record<string, ActionState>,
    // 半屏详情
    halfScreenVisible: false,
    halfScreenActivityId: '',
  },

  observers: {
    'results, center, title': function (
      results: ExploreResult[],
      center: CenterPoint,
      title: string,
    ) {
      // 自包含模式：直接用 results 渲染
      const fetchConfig = readFetchConfig(this.properties.fetchConfig);
      if (fetchConfig) return; // 引用模式由 fetchConfig observer 处理

      const displayResults = readExploreResults(results).slice(0, 3);
      const resolvedCenter = readCenterPoint(center);
      const headerTitle =
        readString(title) || this.generateTitle(resolvedCenter, displayResults.length);
      this.setData({ displayResults, headerTitle });
    },

    'fetchConfig, interaction, preview': function (
      fetchConfig: FetchConfig | null,
      interaction: Interaction | null,
      preview: PreviewData | null,
    ) {
      const resolvedFetchConfig = readFetchConfig(fetchConfig);
      if (!resolvedFetchConfig) return;

      // 引用模式初始化
      const resolvedInteraction = readInteraction(interaction);
      const resolvedPreview = readPreviewData(preview);
      const swiperMode = resolvedInteraction?.swipeable === true;
      const title = readString(this.properties.title);
      const headerTitle =
        title ||
        (resolvedPreview
          ? `为你找到附近的 ${resolvedPreview.total} 个热门活动`
          : '正在加载附近活动...');

      this.setData({ swiperMode, headerTitle });
      void this.loadReferenceData(resolvedFetchConfig);
    },
  },

  methods: {
    /** 生成标题 */
    generateTitle(center: CenterPoint, count: number): string {
      if (!center?.name) {
        return `为你找到附近的 ${count} 个热门活动`;
      }
      return `为你找到${center.name}附近的 ${count} 个热门活动`;
    },

    /** 引用模式：加载数据 */
    async loadReferenceData(fetchConfig: FetchConfig) {
      this.setData({ fetchState: 'loading' });

      const result = await fetchWidgetData(fetchConfig.source, fetchConfig.params);

      if (result.state === 'success' && result.data) {
        const items = readExploreResults(result.data);
        this.setData({
          fetchState: 'success',
          fetchedResults: items,
          displayResults: this.data.swiperMode ? items : items.slice(0, 3),
        });
      } else {
        this.setData({ fetchState: 'error' });
      }
    },

    /** 重试加载 */
    onRetryFetch() {
      const fetchConfig = readFetchConfig(this.properties.fetchConfig);
      if (fetchConfig) {
        void this.loadReferenceData(fetchConfig);
      }
    },

    /** 点击展开地图 */
    onExpandMap() {
      const results = this.data.fetchedResults.length
        ? this.data.fetchedResults
        : readExploreResults(this.properties.results);
      const center = readCenterPoint(this.properties.center);

      this.triggerEvent('expandmap', { results, center });

      wx.navigateTo({
        url: `/subpackages/activity/explore/index?lat=${center.lat}&lng=${center.lng}&results=${encodeURIComponent(JSON.stringify(results))}&animate=expand`,
      });
    },

    /** 点击活动项 */
    onActivityTap(e: WechatMiniprogram.TouchEvent) {
      const id = readString(e.currentTarget.dataset.id);
      if (!id) return;

      const interaction = readInteraction(this.properties.interaction);

      if (interaction?.halfScreenDetail) {
        // 引用模式：弹出半屏详情
        this.setData({ halfScreenVisible: true, halfScreenActivityId: id });
      } else {
        // 自包含模式：跳转详情页
        this.triggerEvent('activitytap', { id });
        wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${id}` });
      }
    },

    /** Swiper 切换 */
    onSwiperChange(e: WechatMiniprogram.SwiperChange) {
      this.setData({ activeIndex: e.detail.current });
    },

    /** 关闭半屏详情 */
    onHalfScreenClose() {
      this.setData({ halfScreenVisible: false, halfScreenActivityId: '' });
    },

    /** 卡内操作按钮点击 */
    toTurnsAction(actionType: string): string {
      const map: Record<string, string> = {
        join: 'join_activity',
        publish: 'confirm_publish',
        confirm_match: 'confirm_match',
        cancel: 'cancel_activity',
      };

      return map[actionType] || actionType;
    },

    async submitJoinFromWidget(payload: JoinFlowPayload, stateKey?: string) {
      const currentUser = useUserStore.getState().user;

      if (!currentUser?.phoneNumber) {
        if (stateKey) {
          this.setData({ [`actionStates.${stateKey}`]: 'idle' });
        }

        useAppStore.getState().showAuthSheet({
          type: 'join',
          payload: {
            ...payload,
            source: payload.source || 'widget_explore',
          },
        });
        return;
      }

      const resolvedPayload = {
        ...payload,
        source: payload.source || 'widget_explore',
      };

      const joinResult = await submitJoinAndOpenDiscussion(resolvedPayload, {
        onBeforeNavigate: () => {
          if (stateKey) {
            this.setData({ [`actionStates.${stateKey}`]: 'success' });
          }

          const title = payload.title || '活动';
          useChatStore.getState().appendActionResult(
            'join',
            { activityId: payload.activityId, title },
            true,
            `你已成功报名「${title}」，一起去讨论区打个招呼吧`,
          );
        },
      });

      if (!joinResult.success) {
        if (stateKey) {
          this.setData({ [`actionStates.${stateKey}`]: 'idle' });
        }

        wx.showToast({
          title: joinResult.msg || '报名失败，请重试',
          icon: 'none',
        });
        return;
      }

      if (stateKey) {
        setTimeout(() => {
          this.setData({ [`actionStates.${stateKey}`]: 'idle' });
        }, 900);
      }
    },

    onActionTap(e: WechatMiniprogram.TouchEvent) {
      const dataset = e.currentTarget.dataset;
      const actionType = readString(dataset.actiontype);
      const activityId = readString(dataset.activityid);
      const activityTitle = readString(dataset.activitytitle);
      const startAt = readString(dataset.startat);
      const locationName = readString(dataset.locationname);
      const actionParams = isRecord(dataset.actionparams) ? dataset.actionparams : null;

      if (!actionType || !activityId) return;

      const stateKey = `${activityId}_${actionType}`;
      const currentState = this.data.actionStates[stateKey];
      if (currentState === 'loading' || currentState === 'success') return;

      wx.vibrateShort({ type: 'light' });

      const payload: Record<string, unknown> = {
        activityId: activityId,
      };
      if (activityTitle) {
        payload.title = activityTitle;
      }
      if (startAt) {
        payload.startAt = startAt;
      }
      if (locationName) {
        payload.locationName = locationName;
      }
      if (actionParams) {
        Object.entries(actionParams).forEach(([key, value]) => {
          payload[key] = value;
        });
      }

      // 特殊处理：share 由组件层处理
      if (actionType === 'share') {
        this.triggerEvent('share', { activityId, title: activityTitle ?? '' });
        return;
      }

      // 特殊处理：detail 触发半屏
      if (actionType === 'detail') {
        this.setData({ halfScreenVisible: true, halfScreenActivityId: activityId });
        return;
      }

      if (actionType === 'join') {
        const joinPayload = readJoinPayload(payload);
        if (!joinPayload) {
          return;
        }
        this.setData({ [`actionStates.${stateKey}`]: 'loading' });
        void this.submitJoinFromWidget(joinPayload, stateKey);
        return;
      }

      // 通用操作：统一走 turns action
      this.setData({ [`actionStates.${stateKey}`]: 'loading' });
      const chatStore = useChatStore.getState();

      chatStore.sendAction({
        action: this.toTurnsAction(actionType),
        payload,
        source: 'widget_explore',
        originalText: activityTitle ? `处理「${activityTitle}」` : `执行${actionType}`,
      });

      this.setData({ [`actionStates.${stateKey}`]: 'success' });
      setTimeout(() => {
        this.setData({ [`actionStates.${stateKey}`]: 'idle' });
      }, 900);
    },

    /** 点击报名按钮（结构化动作链路，自包含模式保留） */
    onJoinTap(e: WechatMiniprogram.TouchEvent) {
      const id = readString(e.currentTarget.dataset.id);
      const title = readString(e.currentTarget.dataset.title) ?? undefined;
      if (!id) return;

      wx.vibrateShort({ type: 'light' });

      void this.submitJoinFromWidget({
        activityId: id,
        title,
        source: 'widget_explore',
      });
    },

    onCreateActivityTap() {
      const center = readCenterPoint(this.properties.center);
      const semanticQuery = readString(this.properties.semanticQuery) ?? '';
      const promptParts = [
        `附近还没有合适的局，我想在${center.name || '附近'}发起一个新的线下活动。`,
        semanticQuery ? `需求参考：${semanticQuery}。` : '',
        '先帮我判断要不要自己组，如果需要，再帮我整理成一个可发布的活动草稿。',
      ];
      const prompt = promptParts.filter((item) => item).join('');

      useChatStore.getState().sendAction({
        action: 'create_activity',
        payload: {
          description: prompt,
          locationName: center.name || '附近',
          semanticQuery,
        },
        source: 'widget_explore',
        originalText: prompt,
      });
    },

    /** 点击位置卡片 */
    onLocationTap() {
      this.onExpandMap();
    },
  },
});
