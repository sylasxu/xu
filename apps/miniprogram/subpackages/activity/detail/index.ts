/**
 * 活动详情页
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 10.1-10.7, 16.1-16.6
 */
import { getActivitiesById, deleteActivitiesById, patchActivitiesByIdStatus } from '../../../src/api/endpoints/activities/activities';
import { getActivitiesByIdPublic } from '../../../src/api/endpoints/activities/activities';
import { useChatStore } from '../../../src/stores/chat';
import { useAppStore } from '../../../src/stores/app';
import { useUserStore } from '../../../src/stores/user';
import { buildJoinStructuredAction } from '../../../src/utils/join-flow'
import type { ActivityPublicResponseRecentMessagesItem as RecentMessage } from '../../../src/api/model';

interface User {
  id: string;
  nickname?: string;
  avatarUrl?: string;
  phoneNumber?: string;
}

interface Participant {
  id: string;
  userId: string;
  status: 'joined' | 'waitlist' | 'quit';
  user?: User;
}

type ActivityJoinState = 'creator' | 'joined' | 'waitlisted' | 'not_joined' | 'closed';

interface Activity {
  id: string;
  title: string;
  description?: string;
  images?: string[];
  startAt?: string;
  endAt?: string;
  locationName?: string;
  address?: string;
  locationHint?: string;
  maxParticipants?: number;
  currentParticipants?: number;
  remainingSeats?: number;
  isFull?: boolean;
  type?: string;
  status?: 'draft' | 'active' | 'completed' | 'cancelled';
  joinState?: ActivityJoinState;
  canJoin?: boolean;
  creatorId: string;
  creator?: User;
  participants?: Participant[];
}

interface ManageAction {
  label: string;
  value: string;
}

interface PageData {
  activityId: string;
  activity: Activity | null;
  currentUser: User | null;
  loading: boolean;
  error: boolean;
  errorMsg: string;
  isJoining: boolean;
  isHotActivity: boolean;
  joinState: ActivityJoinState | null;
  isCreator: boolean;
  // 管理操作面板
  showManageSheet: boolean;
  manageActions: ManageAction[];
  // Auth sheet
  isAuthSheetVisible: boolean;
  // 举报弹窗
  showReportSheet: boolean;
  // v5.0: 讨论区预览
  recentMessages: RecentMessage[];
}

interface PageOptions {
  id?: string;
  share?: string;
}

function normalizeCurrentUser(value: ReturnType<typeof useUserStore.getState>['user']): User | null {
  if (!value?.id) {
    return null;
  }

  return {
    id: value.id,
    nickname: value.nickname || undefined,
    avatarUrl: value.avatarUrl || undefined,
    phoneNumber: value.phoneNumber || undefined,
  };
}

const STATUS_TEXT: Record<ActivityJoinState | Participant['status'], string> = {
  creator: '我发起的',
  joined: '已加入',
  waitlisted: '候补中',
  waitlist: '候补中',
  not_joined: '我要报名',
  closed: '已停止加入',
  quit: '已退出',
};

Page<PageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    activityId: '',
    activity: null,
    currentUser: null,
    loading: true,
    error: false,
    errorMsg: '',
    isJoining: false,
    isHotActivity: false,
    joinState: null,
    isCreator: false,
    // 管理操作面板
    showManageSheet: false,
    manageActions: [],
    // Auth sheet
    isAuthSheetVisible: false,
    // 举报弹窗
    showReportSheet: false,
    // v5.0: 讨论区预览
    recentMessages: [],
  },

  onLoad(options: PageOptions) {
    const { id } = options;
    if (id) {
      this.setData({ activityId: id });
      this.loadActivityDetail(id);
      this.loadCurrentUser();
    } else {
      this.setData({
        loading: false,
        error: true,
        errorMsg: '活动ID不存在',
      });
    }
    
    // 订阅 auth sheet 状态
    this.unsubscribeAppStore = useAppStore.subscribe((state) => {
      if (this.data.isAuthSheetVisible !== state.isAuthSheetVisible) {
        this.setData({ isAuthSheetVisible: state.isAuthSheetVisible });
      }
    });
  },
  
  onUnload() {
    // 取消订阅
    if (this.unsubscribeAppStore) {
      this.unsubscribeAppStore();
    }
  },
  
  // Store 订阅取消函数
  unsubscribeAppStore: null as (() => void) | null,

  onShow() {
    if (this.data.activityId) {
      this.loadActivityDetail(this.data.activityId);
    }
  },

  async loadActivityDetail(id: string) {
    this.setData({ loading: true, error: false });

    try {
      const response = await getActivitiesById(id);

      if (response.status === 200) {
        const activity = response.data as Activity;

        const isHotActivity = activity.status === 'active' && (activity.remainingSeats ?? activity.maxParticipants ?? 0) <= 1;

        const currentUserId = wx.getStorageSync('userId') as string;
        const isCreator = activity.creatorId === currentUserId || activity.joinState === 'creator';
        const joinState = activity.joinState || (isCreator ? 'creator' : activity.canJoin ? 'not_joined' : 'closed');

        this.setData({
          activity,
          loading: false,
          isHotActivity,
          isCreator,
          joinState,
        });

        // v5.0: 异步加载讨论区预览消息（不阻塞主流程）
        this.loadRecentMessages(id);
      } else {
        throw new Error((response.data as { msg?: string })?.msg || '获取活动详情失败');
      }
    } catch (error) {
      console.error('加载活动详情失败', error);
      this.setData({
        loading: false,
        error: true,
        errorMsg: (error as Error).message || '加载失败，请重试',
      });
    }
  },

  /** v5.0: 从公开端点加载讨论区预览消息 */
  async loadRecentMessages(id: string) {
    try {
      const response = await getActivitiesByIdPublic(id);
      if (response.status === 200) {
        this.setData({
          recentMessages: response.data.recentMessages || [],
        });
      }
    } catch (error) {
      // 讨论区预览加载失败不影响主流程
      console.error('加载讨论区预览失败', error);
    }
  },

  async loadCurrentUser(): Promise<void> {
    const userStore = useUserStore.getState();
    const currentUser = userStore.user;
    const normalizedUser = normalizeCurrentUser(currentUser);
    if (!normalizedUser) return;

    this.setData({ currentUser: normalizedUser });

    try {
      await userStore.refreshUserInfo();
      const refreshedUser = useUserStore.getState().user;
      const refreshedNormalizedUser = normalizeCurrentUser(refreshedUser);
      if (refreshedNormalizedUser?.id === normalizedUser.id) {
        this.setData({ currentUser: refreshedNormalizedUser });
      }
    } catch (error) {
      console.error('获取用户信息失败', error);
    }
  },

  onCreatorTap() {
    const { activity } = this.data;
    if (activity?.creator) {
      wx.navigateTo({
        url: `/subpackages/user/profile/index?id=${activity.creatorId}`,
        fail: () => {
          this.showCreatorInfo();
        },
      });
    }
  },

  showCreatorInfo() {
    const { activity } = this.data;
    if (!activity?.creator) return;

    const creator = activity.creator;
    wx.showModal({
      title: creator.nickname || '匿名用户',
      content: '这是活动发起人。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onJoinTap() {
    const { activity, joinState, isCreator, isJoining } = this.data;
    if (!activity || isJoining) {
      return;
    }

    if (!activity.canJoin) {
      wx.showToast({ title: STATUS_TEXT[joinState || 'closed'] || '当前不能加入', icon: 'none' });
      return;
    }

    this.submitJoinAction();
  },
  
  /** 手机号绑定成功回调 */
  onAuthSuccess() {
    // 重新加载用户信息
    this.loadCurrentUser();
  },

  onPendingAction(e: WechatMiniprogram.CustomEvent<{ type: 'structured_action'; action: string; payload: Record<string, unknown>; source?: string; originalText?: string }>) {
    const pendingAction = e.detail;
    if (pendingAction?.type !== 'structured_action' || typeof pendingAction.action !== 'string') {
      return;
    }

    useAppStore.getState().clearPendingAction();
    useChatStore.getState().sendAction({
      action: pendingAction.action,
      payload: pendingAction.payload,
      source: pendingAction.source,
      originalText: pendingAction.originalText,
    });
  },
  
  /** 关闭 auth sheet */
  onAuthClose() {
    useAppStore.getState().hideAuthSheet();
    useAppStore.getState().clearPendingAction();
  },
  
  /** 打开活动管理面板 - Requirements: 16.1-16.6 */
  onManageActivity() {
    const { activity } = this.data;
    if (!activity) return;
    
    const actions: ManageAction[] = [];
    
    // 根据活动状态显示不同操作
    if (activity.status === 'active') {
      actions.push({ label: '查看报名列表', value: 'participants' });
      
      // 只有未开始的活动可以取消
      const startAt = activity.startAt ? new Date(activity.startAt) : null;
      if (startAt && startAt > new Date()) {
        actions.push({ label: '取消活动', value: 'cancel' });
      }
      
      // 已开始的活动可以标记完成
      if (startAt && startAt <= new Date()) {
        actions.push({ label: '标记完成', value: 'complete' });
      }
    } else if (activity.status === 'completed') {
      actions.push({ label: '确认到场情况', value: 'fulfillment' });
    } else if (activity.status === 'draft') {
      actions.push({ label: '编辑活动', value: 'edit' });
      actions.push({ label: '删除草稿', value: 'delete' });
    }
    
    this.setData({
      showManageSheet: true,
      manageActions: actions,
    });
  },
  
  /** 管理操作选择 */
  onManageActionSelect(e: WechatMiniprogram.CustomEvent<{ selected: ManageAction }>) {
    const { value } = e.detail.selected;
    this.setData({ showManageSheet: false });
    
    switch (value) {
      case 'edit':
        this.onEditActivity();
        break;
      case 'participants':
        this.onViewParticipants();
        break;
      case 'cancel':
        this.onCancelActivity();
        break;
      case 'complete':
        this.onCompleteActivity();
        break;
      case 'fulfillment':
        this.onConfirmFulfillment();
        break;
      case 'delete':
        this.onDeleteActivity();
        break;
    }
  },
  
  /** 关闭管理面板 */
  onManageSheetClose() {
    this.setData({ showManageSheet: false });
  },
  
  /** 编辑活动 */
  onEditActivity() {
    const { activityId } = this.data;
    wx.navigateTo({
      url: `/subpackages/activity/draft-edit/index?id=${activityId}`,
    });
  },

  /** 确认到场情况 */
  onConfirmFulfillment() {
    const { activityId } = this.data;
    wx.navigateTo({
      url: `/subpackages/activity/confirm/index?id=${activityId}`,
    });
  },
  
  /** 查看报名列表 */
  onViewParticipants() {
    const { activityId } = this.data;
    wx.navigateTo({
      url: `/subpackages/activity/participants/index?id=${activityId}`,
    });
  },
  
  /** 取消活动 - CP-5: 只有活动创建者可以更新状态 */
  onCancelActivity() {
    wx.showModal({
      title: '确认取消',
      content: '取消后活动将不再显示，已报名的用户会收到通知',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (res.confirm) {
          try {
            const response = await patchActivitiesByIdStatus(this.data.activityId, {
              status: 'cancelled',
            });
            if (response.status === 200) {
              wx.showToast({ title: '活动已取消', icon: 'success' });
              this.loadActivityDetail(this.data.activityId);
            } else {
              throw new Error((response.data as { msg?: string })?.msg || '操作失败');
            }
          } catch (error) {
            wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' });
          }
        }
      },
    });
  },
  
  /** 标记活动完成 */
  onCompleteActivity() {
    wx.showModal({
      title: '确认完成',
      content: '标记完成后会进入到场确认，方便继续做再约和关系沉淀。',
      success: async (res) => {
        if (res.confirm) {
          try {
            const response = await patchActivitiesByIdStatus(this.data.activityId, {
              status: 'completed',
            });
            if (response.status === 200) {
              wx.showToast({ title: '活动已完成', icon: 'success' });
              setTimeout(() => {
                this.onConfirmFulfillment();
              }, 1200);
            } else {
              throw new Error((response.data as { msg?: string })?.msg || '操作失败');
            }
          } catch (error) {
            wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' });
          }
        }
      },
    });
  },
  
  /** 删除草稿 - CP-6: 只有 active 且未开始的活动可以删除 */
  onDeleteActivity() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (res.confirm) {
          try {
            const response = await deleteActivitiesById(this.data.activityId);
            if (response.status === 200) {
              wx.showToast({ title: '已删除', icon: 'success' });
              setTimeout(() => {
                const pages = getCurrentPages();
                if (pages.length > 1) {
                  wx.navigateBack();
                } else {
                  wx.reLaunch({ url: '/pages/home/index' });
                }
              }, 1500);
            } else {
              throw new Error((response.data as { msg?: string })?.msg || '删除失败');
            }
          } catch (error) {
            wx.showToast({ title: (error as Error).message || '删除失败', icon: 'none' });
          }
        }
      },
    });
  },

  async submitJoinAction() {
    const { activityId, isJoining } = this.data;
    const activity = this.data.activity;

    if (isJoining) return;

    this.setData({ isJoining: true });

    try {
      const pendingAction = buildJoinStructuredAction({
        activityId,
        title: activity?.title,
        startAt: activity?.startAt,
        locationName: activity?.locationName,
        source: 'activity_detail',
      });

      useChatStore.getState().sendAction({
        action: pendingAction.action,
        payload: pendingAction.payload,
        source: pendingAction.source,
        originalText: pendingAction.originalText,
      });
    } catch (error) {
      console.error('报名失败', error);
      wx.showToast({ title: (error as Error).message || '报名失败', icon: 'none' });
    } finally {
      this.setData({ isJoining: false });
    }
  },

  onEnterChat() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    const { activityId, joinState, isCreator } = this.data;

    if (!isCreator && joinState !== 'joined') {
      wx.showToast({ title: '需要报名才能进入讨论区', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: `/subpackages/activity/discussion/index?id=${activityId}`,
    });
  },

  /**
   * 微信原生分享 - Requirements: 13.1, 13.2, 13.3, 13.4
   * 
   * 零成本方案：分享卡片不使用地图预览图，使用默认封面或纯文字
   * - 使用 AI 生成的骚气标题（如果有）
   * - 计算空位数显示在标题中
   */
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const { activity } = this.data;
    if (!activity) {
      return {
        title: '聚场 - 微信群组局神器',
        path: `/subpackages/activity/detail/index?id=${this.data.activityId}&share=1`,
      };
    }

    // v5.0: 分享卡片优化 - 包含报名人数制造 FOMO - Requirements: 9.1
    const currentCount = activity.currentParticipants || 0;
    const maxCount = activity.maxParticipants || 0;
    const vacancy = maxCount - currentCount;

    let shareTitle = '';
    if (vacancy > 0) {
      shareTitle = `已有${currentCount}人报名，还差${vacancy}人！| ${activity.title}`;
    } else {
      shareTitle = `已满员！| ${activity.title}`;
    }

    return {
      title: shareTitle,
      path: `/subpackages/activity/detail/index?id=${this.data.activityId}&share=1`,
      // 零成本方案：使用活动图片或默认封面，不使用地图预览图
      imageUrl: activity.images?.[0] || '',
    };
  },

  /**
   * 分享到朋友圈 - Requirements: 13.1
   */
  onShareTimeline(): WechatMiniprogram.Page.ICustomShareContent {
    const { activity } = this.data;
    if (!activity) {
      return {
        title: '聚场 - 微信群组局神器',
      };
    }

    // 计算空位数
    const vacancy = (activity.maxParticipants || 0) - (activity.currentParticipants || 0);
    const vacancyText = vacancy > 0 ? `${vacancy}缺1` : '已满员';

    return {
      title: `${activity.title} | ${vacancyText} | 聚场`,
      // 零成本方案：使用活动图片或默认封面
      imageUrl: activity.images?.[0] || '',
    };
  },

  onCopyActivityText() {
    const { activity } = this.data;
    if (!activity) {
      wx.showToast({ title: '活动信息未加载完成', icon: 'none' });
      return;
    }

    const text = this.buildActivityCopyText(activity);
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '文案已复制', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' });
      },
    });
  },

  buildActivityCopyText(activity: Activity): string {
    const startAtText = activity.startAt ? this.formatDateTime(activity.startAt) : '时间待定';
    const locationText = this.getDisplayAddress() || activity.locationHint || '地点待定';
    const current = activity.currentParticipants || 0;
    const max = activity.maxParticipants || 0;
    const desc = activity.description || '欢迎一起参与，详情见小程序活动页。';
    return [
      `【${activity.title}】`,
      `时间：${startAtText}`,
      `地点：${locationText}`,
      `人数：${current}/${max} 人`,
      '',
      desc,
      '',
      '点击小程序卡片即可报名',
    ].join('\n');
  },

  onCloneActivity() {
    const { activity } = this.data;
    if (!activity) {
      wx.showToast({ title: '活动信息未加载完成', icon: 'none' });
      return;
    }

    const prompt = this.buildClonePrompt(activity);
    wx.reLaunch({
      url: `/pages/home/index?prefill=${encodeURIComponent(prompt)}`,
      fail: () => {
        wx.navigateTo({
          url: `/pages/home/index?prefill=${encodeURIComponent(prompt)}`,
        });
      },
    });
  },

  buildClonePrompt(activity: Activity): string {
    const typeLabelMap: Record<string, string> = {
      food: '美食',
      entertainment: '娱乐',
      sports: '运动',
      boardgame: '桌游',
      other: '活动',
    };
    const typeText = activity.type ? (typeLabelMap[activity.type] || activity.type) : '活动';
    const locationText = activity.locationName || activity.locationHint || '附近';
    const max = activity.maxParticipants || 4;
    return `我想约一个和「${activity.title}」类似的${typeText}局，地点优先在${locationText}附近，人数大概${max}人。先帮我看看附近有没有现成的合适活动，没有再帮我生成一个更容易成局的草稿。`;
  },

  onRefresh() {
    if (this.data.activityId) {
      this.loadActivityDetail(this.data.activityId);
    }
  },

  /** 打开举报弹窗 */
  onReportTap() {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ showReportSheet: true });
  },

  /** 关闭举报弹窗 */
  onReportClose() {
    this.setData({ showReportSheet: false });
  },

  /** 举报成功回调 */
  onReportSuccess() {
    this.setData({ showReportSheet: false });
  },

  formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return '时间待定';
    }
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  },

  getDisplayAddress(): string {
    const { activity } = this.data;
    if (!activity) return '';

    return activity.address || activity.locationName || activity.locationHint || '';
  },
});
