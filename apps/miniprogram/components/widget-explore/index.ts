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
import type { FetchState } from '../../src/utils/widget-fetcher';
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
  source: string;
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

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 现有（不变）
    results: { type: Array, value: [] as ExploreResult[] },
    center: {
      type: Object,
      value: { lat: 29.5647, lng: 106.5507, name: '观音桥' } as CenterPoint,
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
      const props = this.properties as unknown as WidgetExploreProperties;
      const fetchConfig = props.fetchConfig;
      if (fetchConfig) return; // 引用模式由 fetchConfig observer 处理

      const displayResults = (results || []).slice(0, 3);
      const headerTitle = title || this.generateTitle(center, results?.length || 0);
      this.setData({ displayResults, headerTitle });
    },

    'fetchConfig, interaction, preview': function (
      fetchConfig: FetchConfig | null,
      interaction: Interaction | null,
      preview: PreviewData | null,
    ) {
      if (!fetchConfig) return;

      // 引用模式初始化
      const swiperMode = !!interaction?.swipeable;
      const headerTitle =
        this.properties.title ||
        (preview
          ? `为你找到附近的 ${preview.total} 个热门活动`
          : '正在加载附近活动...');

      this.setData({ swiperMode, headerTitle });
      void this.loadReferenceData(fetchConfig);
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
        const items = (Array.isArray(result.data) ? result.data : []) as ExploreResult[];
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
      const props = this.properties as unknown as WidgetExploreProperties;
      const fetchConfig = props.fetchConfig || null;
      if (fetchConfig) {
        void this.loadReferenceData(fetchConfig);
      }
    },

    /** 点击展开地图 */
    onExpandMap() {
      const props = this.properties as unknown as WidgetExploreProperties;
      const results = this.data.fetchedResults.length
        ? this.data.fetchedResults
        : (props.results || []);
      const center = props.center || { lat: 29.5647, lng: 106.5507, name: '观音桥' };

      this.triggerEvent('expandmap', { results, center });

      wx.navigateTo({
        url: `/subpackages/activity/explore/index?lat=${center.lat}&lng=${center.lng}&results=${encodeURIComponent(JSON.stringify(results))}&animate=expand`,
        routeType: 'none',
      } as WechatMiniprogram.NavigateToOption & { routeType?: string });
    },

    /** 点击活动项 */
    onActivityTap(e: WechatMiniprogram.TouchEvent) {
      const { id } = e.currentTarget.dataset;
      if (!id) return;

      const props = this.properties as unknown as WidgetExploreProperties;
      const interaction = props.interaction || null;

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
      const { actiontype, activityid, activitytitle, startat, locationname, actionparams } =
        e.currentTarget.dataset;
      if (!actiontype || !activityid) return;

      const stateKey = `${activityid}_${actiontype}`;
      const currentState = this.data.actionStates[stateKey];
      if (currentState === 'loading' || currentState === 'success') return;

      wx.vibrateShort({ type: 'light' });

      const payload: Record<string, unknown> = {
        activityId: activityid,
        title: activitytitle,
        startAt: startat,
        locationName: locationname,
      };
      if (actionparams && typeof actionparams === 'object') {
        Object.assign(payload, actionparams as Record<string, unknown>);
      }

      // 特殊处理：share 由组件层处理
      if (actiontype === 'share') {
        this.triggerEvent('share', { activityId: activityid, title: activitytitle });
        return;
      }

      // 特殊处理：detail 触发半屏
      if (actiontype === 'detail') {
        this.setData({ halfScreenVisible: true, halfScreenActivityId: activityid });
        return;
      }

      if (actiontype === 'join') {
        this.setData({ [`actionStates.${stateKey}`]: 'loading' });
        void this.submitJoinFromWidget(payload as unknown as JoinFlowPayload, stateKey);
        return;
      }

      // 通用操作：统一走 turns action
      this.setData({ [`actionStates.${stateKey}`]: 'loading' });
      const chatStore = useChatStore.getState();

      chatStore.sendAction({
        action: this.toTurnsAction(actiontype),
        payload,
        source: 'widget_explore',
        originalText: activitytitle ? `处理「${activitytitle}」` : `执行${actiontype}`,
      });

      this.setData({ [`actionStates.${stateKey}`]: 'success' });
      setTimeout(() => {
        this.setData({ [`actionStates.${stateKey}`]: 'idle' });
      }, 900);
    },

    /** 点击报名按钮 (A2UI — 自包含模式保留) */
    onJoinTap(e: WechatMiniprogram.TouchEvent) {
      const { id, title } = e.currentTarget.dataset;
      if (!id) return;

      wx.vibrateShort({ type: 'light' });

      void this.submitJoinFromWidget({
        activityId: id,
        title,
        source: 'widget_explore',
      });
    },

    onCreateActivityTap() {
      const props = this.properties as unknown as WidgetExploreProperties;
      const center = props.center || { lat: 29.5647, lng: 106.5507, name: '附近' };
      const semanticQuery = typeof props.semanticQuery === 'string' ? props.semanticQuery.trim() : '';
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
