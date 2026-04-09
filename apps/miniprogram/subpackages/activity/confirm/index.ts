/**
 * 履约确认页面
 * Requirements: 10.1, 10.2, 10.3, 10.4
 * - 活动结束后发起人确认参与者到场情况
 * - 显示参与者列表（默认全选已到场）
 * - 标记未到场警告提示
 * - 调用履约确认API
 */
import {
  getParticipantsActivityById,
  postParticipantsConfirmFulfillment,
} from '../../../src/api/endpoints/participants/participants';
import { getActivitiesById } from '../../../src/api/endpoints/activities/activities';
import type { GetParticipantsActivityById200Item } from '../../../src/api/model';
import { useChatStore } from '../../../src/stores/chat';
import { postActivityRebookFollowUp } from '../../../src/services/activity-outcome';

// ==================== 类型定义 ====================

/** 参与者信息 */
interface Participant {
  id: string;
  userId: string;
  nickname: string;
  avatarUrl: string;
  status: string;
  /** 是否已到场（用于UI选择） */
  fulfilled: boolean;
}

/** 活动信息 */
interface ActivityInfo {
  id: string;
  title: string;
  startAt: string;
  endAt?: string;
  locationName: string;
  status: string;
}

/** 页面数据 */
interface FulfillmentResult {
  activityId: string;
  attendedCount: number;
  noShowCount: number;
  totalSubmitted: number;
  msg: string;
}

interface PageData {
  /** 活动 ID */
  activityId: string;
  /** 活动信息 */
  activity: ActivityInfo | null;
  /** 参与者列表 */
  participants: Participant[];
  /** 加载状态 */
  loading: boolean;
  /** 提交状态 */
  submitting: boolean;
  /** 未到场人数 */
  noShowCount: number;
  /** 是否显示警告弹窗 */
  showWarningDialog: boolean;
  /** 当前操作的参与者 */
  currentParticipant: Participant | null;
}

/** 页面参数 */
interface PageOptions {
  id?: string;
}

Page<PageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    activityId: '',
    activity: null,
    participants: [],
    loading: true,
    submitting: false,
    noShowCount: 0,
    showWarningDialog: false,
    currentParticipant: null,
  },

  onLoad(options: PageOptions) {
    const { id } = options;
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
      return;
    }

    this.setData({ activityId: id });
    this.loadData();
  },

  // ==================== 数据加载 ====================

  async loadData() {
    this.setData({ loading: true });

    try {
      const [activityResult, participantsResult] = await Promise.all([
        this.loadActivityInfo(),
        this.loadParticipants(),
      ]);

      this.setData({
        activity: activityResult,
        participants: participantsResult,
        loading: false,
      });
    } catch (error) {
      console.error('加载数据失败', error);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /** 加载活动信息 */
  async loadActivityInfo(): Promise<ActivityInfo | null> {
    try {
      const response = await getActivitiesById(this.data.activityId);
      if (response.status === 200) {
        const data = response.data as {
          id: string;
          title: string;
          startAt: string;
          endAt?: string;
          locationName: string;
          status: string;
        };
        return {
          id: data.id,
          title: data.title,
          startAt: data.startAt,
          endAt: data.endAt,
          locationName: data.locationName,
          status: data.status,
        };
      }
      return null;
    } catch (error) {
      console.error('加载活动信息失败', error);
      return null;
    }
  },

  /** 加载参与者列表 (Requirements: 10.2) */
  async loadParticipants(): Promise<Participant[]> {
    try {
      const response = await getParticipantsActivityById(this.data.activityId);
      if (response.status === 200 && Array.isArray(response.data)) {
        const participants = response.data as GetParticipantsActivityById200Item[];
        return participants
          .filter((p) => p.status === 'joined')
          .map((p) => ({
            id: p.id,
            userId: p.userId,
            nickname: p.user?.nickname || '未知用户',
            avatarUrl: p.user?.avatarUrl || '',
            status: p.status,
            fulfilled: true,
          }));
      }
      return [];
    } catch (error) {
      console.error('加载参与者列表失败', error);
      return [];
    }
  },

  // ==================== 事件处理 ====================

  /** 切换参与者到场状态 */
  onToggleFulfilled(e: WechatMiniprogram.TouchEvent) {
    const { index } = e.currentTarget.dataset as { index: number };
    const participant = this.data.participants[index];

    if (!participant) return;

    if (participant.fulfilled) {
      this.setData({
        showWarningDialog: true,
        currentParticipant: participant,
      });
    } else {
      this.updateParticipantStatus(index, true);
    }
  },

  /** 确认标记未到场 */
  onConfirmNoShow() {
    const { currentParticipant, participants } = this.data;
    if (!currentParticipant) return;

    const index = participants.findIndex((p) => p.id === currentParticipant.id);
    if (index >= 0) {
      this.updateParticipantStatus(index, false);
    }

    this.setData({
      showWarningDialog: false,
      currentParticipant: null,
    });
  },

  /** 取消标记未到场 */
  onCancelNoShow() {
    this.setData({
      showWarningDialog: false,
      currentParticipant: null,
    });
  },

  /** 更新参与者状态 */
  updateParticipantStatus(index: number, fulfilled: boolean) {
    const participants = [...this.data.participants];
    participants[index] = { ...participants[index], fulfilled };

    const noShowCount = participants.filter((p) => !p.fulfilled).length;

    this.setData({ participants, noShowCount });
  },

  /** 全选已到场 */
  onSelectAll() {
    const participants = this.data.participants.map((p) => ({
      ...p,
      fulfilled: true,
    }));
    this.setData({ participants, noShowCount: 0 });
  },

  /** 提交履约确认 (Requirements: 10.4) */
  async onSubmit() {
    const { submitting, noShowCount } = this.data;

    if (submitting) return;

    if (noShowCount > 0) {
      wx.showModal({
        title: '确认提交',
        content: `您标记了 ${noShowCount} 人未到场，确认提交吗？`,
        confirmText: '确认提交',
        confirmColor: '#FF6B35',
        success: (res) => {
          if (res.confirm) {
            this.submitFulfillment();
          }
        },
      });
    } else {
      this.submitFulfillment();
    }
  },

  async submitFulfillment() {
    const { activityId, participants } = this.data;

    this.setData({ submitting: true });

    try {
      const fulfillmentData = participants.map((p) => ({
        userId: p.userId,
        fulfilled: p.fulfilled,
      }));

      const response = await postParticipantsConfirmFulfillment({
        activityId,
        participants: fulfillmentData,
      });

      if (response.status !== 200) {
        throw new Error((response.data as { msg?: string })?.msg || '提交失败');
      }

      const result = response.data as FulfillmentResult;
      this.setData({ submitting: false });
      this.handleFulfillmentSuccess(result);
    } catch (error) {
      console.error('提交履约确认失败', error);
      wx.showToast({
        title: (error as Error).message || '提交失败',
        icon: 'none',
      });
      this.setData({ submitting: false });
    }
  },

  handleFulfillmentSuccess(result: FulfillmentResult) {
    const summary = this.buildFulfillmentSummary(result.attendedCount, result.noShowCount);

    wx.showModal({
      title: '履约确认已完成',
      content: summary,
      confirmText: '去再约',
      cancelText: '回详情',
      confirmColor: '#FF6B35',
      success: (modalRes) => {
        if (modalRes.confirm) {
          this.openRebookFlow(result.attendedCount, result.noShowCount);
          return;
        }

        this.goBackToActivityDetail();
      },
      fail: () => {
        this.goBackToActivityDetail();
      },
    });
  },

  async openRebookFlow(attendedCount: number, noShowCount: number) {
    const { activityId } = this.data;

    if (activityId) {
      try {
        const response = await postActivityRebookFollowUp(activityId);
        if (response.status !== 200) {
          console.warn('记录再约意愿失败', response.data);
        }
      } catch (error) {
        console.error('记录再约意愿失败', error);
      }
    }

    const prompt = this.buildRebookPrompt(attendedCount, noShowCount);
    useChatStore.getState().sendMessage(prompt, {
      ...(activityId ? { activityId } : {}),
      activityMode: 'rebook',
      entry: 'confirm_fulfillment',
    });
    wx.switchTab({ url: '/pages/chat/index' });
  },

  goBackToActivityDetail() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({ url: '/pages/chat/index' });
  },

  buildFulfillmentSummary(attendedCount: number, noShowCount: number): string {
    if (noShowCount > 0) {
      return `到场 ${attendedCount} 人，未到场 ${noShowCount} 人。现在可以顺手再约一次，避免这拨人散掉。`;
    }

    return `这局的人基本都到齐了。现在继续再约，最容易把关系续上。`;
  },

  buildRebookPrompt(attendedCount: number, noShowCount: number): string {
    const { activity, participants } = this.data;
    const title = activity?.title || '这场活动';
    const locationName = activity?.locationName || '附近';
    const timeText = activity?.startAt ? this.formatDateTime(activity.startAt) : '最近';
    const attendedNames = participants
      .filter((item) => item.fulfilled)
      .map((item) => item.nickname)
      .filter((name) => Boolean(name))
      .slice(0, 6);

    const segments = [
      `刚结束一场活动「${title}」，地点在${locationName}，时间是${timeText}。`,
      `这次到场 ${attendedCount} 人，未到场 ${noShowCount} 人。`,
      attendedNames.length > 0 ? `到场的人有：${attendedNames.join('、')}。` : '',
      '我想趁热再约这拨人。先帮我看看附近有没有合适的现成同类局；如果没有，再帮我生成一个更容易成局的活动草稿。',
    ];

    return segments.filter((segment) => segment).join('');
  },

  // ==================== 辅助方法 ====================

  /** 格式化时间 */
  formatDateTime(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
  },
});
