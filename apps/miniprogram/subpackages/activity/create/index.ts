/**
 * 创建活动页面
 * Requirements: 7.1, 7.2, 7.4, 7.5, 19.3, 19.4
 * - 实现表单字段（标题/描述/时间/地点/人数）
 * - 位置选择强制填写位置备注
 * - 必填字段校验
 * - 调用创建活动API
 * - 创建活动额度检查
 */
import { postActivities } from '../../../src/api/endpoints/activities/activities';
import type { ActivityCreateRequest } from '../../../src/api/model';
import { useUserStore } from '../../../src/stores/user';

// 类型定义
interface PickerOption {
  label: string;
  value: string;
}

interface ActivityForm {
  title: string;
  description: string;
  images: string[];
  locationName: string;
  address: string;
  locationHint: string;
  latitude: number | null;
  longitude: number | null;
  startAt: string;
  endAt: string;
  type: string;
  maxParticipants: number;
}

interface PageData {
  form: ActivityForm;
  activityTypes: PickerOption[];
  showTypePicker: boolean;
  showStartTimePicker: boolean;
  showEndTimePicker: boolean;
  isSubmitting: boolean;
  maxImageCount: number;
}

interface PageOptions {
  lat?: string;
  lng?: string;
  ghostType?: string;
  // AI 预填数据 - Requirements: 8.7
  title?: string;
  type?: string;
  startAt?: string;
  maxParticipants?: string;
  locationName?: string;
  description?: string;
  aiText?: string;
}

// 活动类型选项
const ACTIVITY_TYPES: PickerOption[] = [
  { label: '美食', value: 'food' },
  { label: '娱乐', value: 'entertainment' },
  { label: '运动', value: 'sports' },
  { label: '桌游', value: 'boardgame' },
  { label: '其他', value: 'other' },
];

Page<PageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    // 表单数据 (Requirements: 7.1)
    form: {
      title: '',
      description: '',
      images: [],
      locationName: '',
      address: '',
      locationHint: '', // 位置备注 (Requirements: 7.2)
      latitude: null,
      longitude: null,
      startAt: '',
      endAt: '',
      type: '',
      maxParticipants: 10,
    },

    // 选项数据
    activityTypes: ACTIVITY_TYPES,

    // 选择器状态
    showTypePicker: false,
    showStartTimePicker: false,
    showEndTimePicker: false,

    // 提交状态
    isSubmitting: false,

    // 图片上传
    maxImageCount: 9,
  },

  onLoad(options: PageOptions) {
    // 检查登录状态 (Requirements: 16.2)
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再创建活动',
        showCancel: false,
        success: () => {
          wx.navigateTo({ url: '/pages/login/login' });
        },
      });
      return;
    }

    // 处理预填数据 - Requirements: 8.7
    const updates: Partial<ActivityForm> = {};

    // 位置信息
    if (options.lat && options.lng) {
      updates.latitude = parseFloat(options.lat);
      updates.longitude = parseFloat(options.lng);
    }
    if (options.locationName) {
      updates.locationName = decodeURIComponent(options.locationName);
    }

    // AI 预填数据
    if (options.title) {
      updates.title = decodeURIComponent(options.title);
    }
    if (options.type) {
      updates.type = options.type;
    }
    if (options.startAt) {
      updates.startAt = decodeURIComponent(options.startAt);
    }
    if (options.maxParticipants) {
      updates.maxParticipants = parseInt(options.maxParticipants, 10);
    }
    if (options.description) {
      updates.description = decodeURIComponent(options.description);
    }

    // 应用预填数据
    if (Object.keys(updates).length > 0) {
      const formUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        formUpdates[`form.${key}`] = value;
      }
      this.setData(formUpdates as Partial<PageData>);
    }
  },

  // ==================== 表单输入处理 ====================

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ 'form.title': e.detail.value });
  },

  onDescriptionInput(e: WechatMiniprogram.Input) {
    this.setData({ 'form.description': e.detail.value });
  },

  onLocationHintInput(e: WechatMiniprogram.Input) {
    this.setData({ 'form.locationHint': e.detail.value });
  },

  onParticipantsChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setData({ 'form.maxParticipants': e.detail.value });
  },

  // ==================== 选择器处理 ====================

  showTypePicker() {
    this.setData({ showTypePicker: true });
  },

  onTypeChange(e: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
    const { value } = e.detail;
    this.setData({
      'form.type': value[0],
      showTypePicker: false,
    });
  },

  onTypePickerCancel() {
    this.setData({ showTypePicker: false });
  },

  // ==================== 时间选择 ====================

  showStartTimePicker() {
    this.setData({ showStartTimePicker: true });
  },

  onStartTimeChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const { value } = e.detail;
    this.setData({
      'form.startAt': value,
      showStartTimePicker: false,
    });
  },

  onStartTimePickerCancel() {
    this.setData({ showStartTimePicker: false });
  },

  showEndTimePicker() {
    this.setData({ showEndTimePicker: true });
  },

  onEndTimeChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const { value } = e.detail;
    this.setData({
      'form.endAt': value,
      showEndTimePicker: false,
    });
  },

  onEndTimePickerCancel() {
    this.setData({ showEndTimePicker: false });
  },

  // ==================== 位置选择 ====================

  onChooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          'form.locationName': res.name || '',
          'form.address': res.address || '',
          'form.latitude': res.latitude,
          'form.longitude': res.longitude,
        });
      },
      fail: (err) => {
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '需要位置权限',
            content: '请在设置中开启位置权限',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting();
              }
            },
          });
        }
      },
    });
  },

  // ==================== 图片上传 ====================

  onImageSuccess(e: WechatMiniprogram.CustomEvent<{ files: Array<{ url?: string; path?: string }> }>) {
    const { files } = e.detail;
    const images = files.map((f) => f.url || f.path || '');
    this.setData({ 'form.images': images });
  },

  onImageRemove(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const { index } = e.detail;
    const images = [...this.data.form.images];
    images.splice(index, 1);
    this.setData({ 'form.images': images });
  },

  // ==================== 表单验证和提交 (Requirements: 7.4) ====================

  validateForm(): string[] {
    const { form } = this.data;
    const errors: string[] = [];

    if (!form.title || form.title.trim().length === 0) {
      errors.push('请输入活动标题');
    } else if (form.title.length > 100) {
      errors.push('活动标题不能超过100个字符');
    }

    if (!form.type) {
      errors.push('请选择活动类型');
    }

    if (!form.startAt) {
      errors.push('请选择活动开始时间');
    }

    if (!form.locationName || !form.latitude || !form.longitude) {
      errors.push('请选择活动地点');
    }

    // 位置备注强制填写 (Requirements: 7.2)
    if (form.latitude && form.longitude && (!form.locationHint || form.locationHint.trim().length === 0)) {
      errors.push('请填写位置备注（如"4楼平台入口"）');
    }

    if (form.maxParticipants < 2) {
      errors.push('参与人数至少为2人');
    }

    if (form.startAt && form.endAt) {
      const startTime = new Date(form.startAt).getTime();
      const endTime = new Date(form.endAt).getTime();
      if (endTime <= startTime) {
        errors.push('结束时间必须晚于开始时间');
      }
    }

    if (form.startAt) {
      const startTime = new Date(form.startAt).getTime();
      if (startTime < Date.now()) {
        errors.push('开始时间不能是过去的时间');
      }
    }

    return errors;
  },

  showCreateQuotaExhaustedTip() {
    wx.showModal({
      title: '创建活动额度已用完',
      content: '今天的创建活动额度用完了，明天再来吧～',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  async onSubmit() {
    const errors = this.validateForm();
    if (errors.length > 0) {
      wx.showToast({
        title: errors[0],
        icon: 'none',
        duration: 2000,
      });
      return;
    }

    const userStore = useUserStore.getState();
    const currentUser = userStore.user;

    // 检查创建活动额度 - Requirements: 19.3, 19.4
    if (!currentUser || (currentUser.aiCreateQuotaToday ?? 0) <= 0) {
      this.showCreateQuotaExhaustedTip();
      return;
    }

    const { form } = this.data;

    this.setData({ isSubmitting: true });

    try {
      const requestData: ActivityCreateRequest = {
        title: form.title.trim(),
        description: form.description?.trim() || undefined,
        locationName: form.locationName,
        address: form.address || undefined,
        locationHint: form.locationHint.trim(),
        location: [form.longitude as number, form.latitude as number], // GeoJSON格式 [lng, lat]
        startAt: new Date(form.startAt).toISOString(),
        type: form.type as ActivityCreateRequest['type'],
        maxParticipants: form.maxParticipants,
      };

      const response = await postActivities(requestData);

      if (response.status === 200) {
        const activityId = (response.data as { id: string }).id;
        useUserStore.getState().recordCreatedActivity();
        this.showSuccessAndShare(activityId);
      } else {
        throw new Error((response.data as { msg?: string })?.msg || '创建活动失败');
      }
    } catch (error) {
      console.error('创建活动失败', error);
      const message = error instanceof Error ? error.message : '创建失败，请重试';
      if (message.includes('今日发布额度已用完') || message.includes('创建活动额度')) {
        this.showCreateQuotaExhaustedTip();
        return;
      }
      wx.showToast({
        title: message,
        icon: 'none',
      });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  showSuccessAndShare(activityId: string) {
    wx.showModal({
      title: '创建成功',
      content: '活动创建成功！是否分享到微信群？',
      confirmText: '去分享',
      cancelText: '查看活动',
      success: (res) => {
        if (res.confirm) {
          wx.redirectTo({
            url: `/subpackages/activity/detail/index?id=${activityId}&share=1`,
          });
        } else {
          wx.redirectTo({
            url: `/subpackages/activity/detail/index?id=${activityId}`,
          });
        }
      },
    });
  },

  // ==================== 辅助方法 ====================

  getTypeLabel(value: string): string {
    const type = ACTIVITY_TYPES.find((t) => t.value === value);
    return type ? type.label : '';
  },

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '我在聚场创建了一个活动，快来参加吧！',
      path: '/pages/home/index',
    };
  },
});
