/**
 * CUI 副驾面板组件
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7
 *
 * AI交互面板，展示流式响应
 * - 思考态：0.5s内开始显示
 * - 搜索态：显示搜索进度和流式文字
 * - 结果态：显示双选卡片（发现活动 + 创建草稿）
 */

// AI流式响应事件类型
export interface AIStreamEvent {
  event: 'thinking' | 'location' | 'searching' | 'result' | 'error' | 'done';
  data?: {
    message?: string;
    name?: string;
    coords?: [number, number];
    progress?: number;
    activities?: Activity[];
    draft?: ActivityDraft;
    error?: string;
  };
}

// 活动类型
interface Activity {
  id: string;
  title: string;
  activityType: string;
  startAt: string;
  location: {
    name: string;
    coords: [number, number];
  };
  currentParticipants: number;
  maxParticipants: number;
}

// 活动草稿类型
export interface ActivityDraft {
  title: string;
  type: string;
  startAt: string;
  location: {
    name: string;
    coords: [number, number];
  };
  maxParticipants: number;
  description?: string;
}

type Phase = 'idle' | 'thinking' | 'searching' | 'result' | 'error';

// 流式文字显示定时器
let streamingTimer: number | null = null;

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    phase: 'idle' as Phase,
    thinkingText: '',
    searchingText: '',
    searchProgress: 0,
    foundActivities: [] as Activity[],
    draftCard: null as ActivityDraft | null,
    errorText: '',
    _inputText: '',
    _streamingTextIndex: 0,
    _fullSearchingText: '',
  },

  observers: {
    visible(newVal: boolean) {
      if (!newVal) {
        this.reset();
      }
    },
  },

  lifetimes: {
    detached() {
      this.clearStreamingTimer();
    },
  },

  methods: {
    /**
     * 开始助手处理流程 - Requirements: 3.1
     */
    startAssistFlow(inputText: string, prefillData?: { type?: string; location?: [number, number] }) {
      this.setData({
        phase: 'thinking',
        thinkingText: '收到，让我想想...',
        _inputText: inputText,
      });
      this.triggerEvent('assist', {
        text: inputText,
        prefillType: prefillData?.type,
        prefillLocation: prefillData?.location,
      });
    },

    /**
     * 处理 AI 流式事件
     */
    handleStreamEvent(event: AIStreamEvent) {
      switch (event.event) {
        case 'thinking':
          this.handleThinking(event.data?.message || '');
          break;
        case 'location':
          this.handleLocation(event.data?.name || '', event.data?.coords);
          break;
        case 'searching':
          this.handleSearching(event.data?.message || '', event.data?.progress || 0);
          break;
        case 'result':
          this.handleResult(event.data?.activities || [], event.data?.draft);
          break;
        case 'error':
          this.handleError(event.data?.error || 'AI 暂时开小差了');
          break;
        case 'done':
          break;
      }
    },

    handleThinking(message: string) {
      this.setData({
        phase: 'thinking',
        thinkingText: message || '收到，让我想想...',
      });
    },

    handleLocation(name: string, coords?: [number, number]) {
      this.setData({ thinkingText: `正在定位${name}...` });
      if (coords) {
        this.triggerEvent('location', { name, lat: coords[1], lng: coords[0] });
      }
    },

    handleSearching(message: string, progress: number) {
      const currentFullText = this.data._fullSearchingText;
      if (message !== currentFullText) {
        this.setData({
          phase: 'searching',
          _fullSearchingText: message,
          _streamingTextIndex: 0,
          searchingText: '',
          searchProgress: progress,
        });
        this.startStreamingText();
      } else {
        this.setData({ searchProgress: progress });
      }
    },

    startStreamingText() {
      this.clearStreamingTimer();
      const fullText = this.data._fullSearchingText;
      let index = 0;
      streamingTimer = Number(setInterval(() => {
        if (index < fullText.length) {
          index++;
          this.setData({
            searchingText: fullText.substring(0, index),
            _streamingTextIndex: index,
          });
        } else {
          this.clearStreamingTimer();
        }
      }, 50));
    },

    clearStreamingTimer() {
      if (streamingTimer) {
        clearInterval(streamingTimer);
        streamingTimer = null;
      }
    },

    handleResult(activities: Activity[], draft?: ActivityDraft) {
      this.clearStreamingTimer();
      this.setData({
        phase: 'result',
        foundActivities: activities,
        draftCard: draft || null,
        searchProgress: 100,
      });
    },

    handleError(errorMessage: string) {
      this.clearStreamingTimer();
      this.setData({ phase: 'error', errorText: errorMessage });
    },

    reset() {
      this.clearStreamingTimer();
      this.setData({
        phase: 'idle',
        thinkingText: '',
        searchingText: '',
        searchProgress: 0,
        foundActivities: [],
        draftCard: null,
        errorText: '',
        _inputText: '',
        _streamingTextIndex: 0,
        _fullSearchingText: '',
      });
    },

    onMaskTap() {
      this.onClose();
    },

    onClose() {
      this.triggerEvent('close');
    },

    onFoundCardTap() {
      const foundActivities = this.data.foundActivities;
      if (foundActivities.length > 0) {
        this.triggerEvent('selectActivities', { activities: foundActivities });
      }
    },

    onDraftPublish(e: WechatMiniprogram.CustomEvent<{ draft: ActivityDraft }>) {
      const { draft } = e.detail;
      this.triggerEvent('createDraft', { draft });
      this.onClose();
    },

    onRetry() {
      const inputText = this.data._inputText;
      if (inputText) {
        this.startAssistFlow(inputText);
      }
    },

    preventScroll() {},

    // 模拟 AI 响应流程（开发调试用）
    simulateAIResponse(inputText: string) {
      this.startAssistFlow(inputText);
      setTimeout(() => this.handleThinking('收到，正在定位观音桥...'), 300);
      setTimeout(() => this.handleLocation('观音桥', [106.5515, 29.5630]), 800);
      setTimeout(() => this.handleSearching('正在检索附近的麻将局...', 30), 1200);
      setTimeout(() => this.handleSearching('正在检索附近的麻将局...', 60), 1600);
      setTimeout(() => this.handleSearching('正在检索附近的麻将局...', 90), 2000);
      setTimeout(() => {
        this.handleResult(
          [{
            id: '1',
            title: '周末麻将局',
            activityType: 'mahjong',
            startAt: '2024-01-20T19:00:00',
            location: { name: '观音桥步行街', coords: [106.5515, 29.5630] },
            currentParticipants: 2,
            maxParticipants: 4,
          }],
          {
            title: '麻将局·3缺1',
            type: 'mahjong',
            startAt: '明晚 19:00',
            location: { name: '观音桥', coords: [106.5515, 29.5630] },
            maxParticipants: 4,
          }
        );
      }, 2500);
    },
  },
});
