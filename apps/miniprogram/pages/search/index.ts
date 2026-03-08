/**
 * 搜索页面
 * 搜索活动，支持历史记录和热门搜索
 */
import { getActivitiesNearby } from '../../src/api/endpoints/activities/activities';
import type { ActivityNearbyItem } from '../../src/api/model';

const STORAGE_KEY_HISTORY = 'search_history';
const MAX_HISTORY_COUNT = 10;

interface SearchResult {
  id: string;
  title: string;
  type: string;
  locationName: string;
  startAt: string;
  currentParticipants: number;
  maxParticipants: number;
  distance?: number;
}

/** 搜索页面数据 */
interface SearchPageData {
  searchValue: string;
  historyWords: string[];
  popularWords: string[];
  searchResults: SearchResult[];
  isSearching: boolean;
  hasSearched: boolean;
  loading: boolean;
}

Page<SearchPageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    searchValue: '',
    historyWords: [],
    popularWords: ['火锅', '剧本杀', '运动', '聚餐', '桌游', '户外'],
    searchResults: [],
    isSearching: false,
    hasSearched: false,
    loading: false,
  },

  onLoad() {
    this.loadHistory();
  },

  onShow() {
    this.loadHistory();
  },

  /**
   * 加载搜索历史
   */
  loadHistory() {
    try {
      const history = wx.getStorageSync(STORAGE_KEY_HISTORY) || [];
      this.setData({ historyWords: history });
    } catch (e) {
      console.error('加载搜索历史失败', e);
    }
  },

  /**
   * 保存搜索历史
   */
  saveHistory(keyword: string) {
    if (!keyword.trim()) return;

    let history = this.data.historyWords.filter((w) => w !== keyword);
    history.unshift(keyword);
    history = history.slice(0, MAX_HISTORY_COUNT);

    this.setData({ historyWords: history });
    wx.setStorageSync(STORAGE_KEY_HISTORY, history);
  },

  /**
   * 执行搜索
   */
  async doSearch(keyword: string) {
    if (!keyword.trim()) return;

    this.setData({
      searchValue: keyword,
      loading: true,
      hasSearched: true,
    });

    this.saveHistory(keyword);

    try {
      // 获取用户位置
      const location = await this.getLocation();

      // 调用搜索 API
      const res = await this.searchActivities(keyword, location);

      this.setData({
        searchResults: res,
        loading: false,
      });
    } catch (error) {
      console.error('搜索失败', error);
      wx.showToast({ title: '搜索失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /**
   * 获取用户位置
   */
  getLocation(): Promise<{ latitude: number; longitude: number }> {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          resolve({ latitude: res.latitude, longitude: res.longitude });
        },
        fail: () => {
          // 默认重庆观音桥
          resolve({ latitude: 29.5647, longitude: 106.5516 });
        },
      });
    });
  },

  /**
   * 搜索活动 API
   */
  async searchActivities(
    keyword: string,
    location: { latitude: number; longitude: number }
  ): Promise<SearchResult[]> {
    const response = await getActivitiesNearby({
      lat: location.latitude,
      lng: location.longitude,
      keyword,
      radius: 5000,
      limit: 20,
    });

    if (response.status !== 200) {
      const errorMessage = (response.data as { msg?: string })?.msg || '搜索附近活动失败';
      throw new Error(errorMessage);
    }

    const items = (response.data.data || []) as ActivityNearbyItem[];
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      locationName: item.locationName,
      startAt: this.formatDateTime(item.startAt),
      currentParticipants: item.currentParticipants,
      maxParticipants: item.maxParticipants,
      distance: item.distance,
    }));
  },

  /**
   * 搜索框提交
   */
  handleSubmit(e: WechatMiniprogram.CustomEvent) {
    const { value } = e.detail;
    if (value.trim()) {
      this.doSearch(value);
    }
  },

  /**
   * 点击历史记录
   */
  handleHistoryTap(e: WechatMiniprogram.CustomEvent) {
    const { index } = e.currentTarget.dataset;
    const keyword = this.data.historyWords[index];
    if (keyword) {
      this.doSearch(keyword);
    }
  },

  /**
   * 点击热门搜索
   */
  handlePopularTap(e: WechatMiniprogram.CustomEvent) {
    const { index } = e.currentTarget.dataset;
    const keyword = this.data.popularWords[index];
    if (keyword) {
      this.doSearch(keyword);
    }
  },

  /**
   * 删除单条历史
   */
  deleteHistory(e: WechatMiniprogram.CustomEvent) {
    const { index } = e.currentTarget.dataset;
    const history = this.data.historyWords.filter((_, i) => i !== index);
    this.setData({ historyWords: history });
    wx.setStorageSync(STORAGE_KEY_HISTORY, history);
  },

  /**
   * 清空历史记录
   */
  handleClearHistory() {
    wx.showModal({
      title: '提示',
      content: '确认清空所有搜索历史？',
      success: (res) => {
        if (res.confirm) {
          this.setData({ historyWords: [] });
          wx.removeStorageSync(STORAGE_KEY_HISTORY);
        }
      },
    });
  },

  /**
   * 点击搜索结果
   */
  handleResultTap(e: WechatMiniprogram.CustomEvent) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${id}`,
    });
  },

  /**
   * 取消搜索
   */
  handleCancel() {
    wx.navigateBack();
  },

  /**
   * 格式化距离
   */
  formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${meters}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  },

  formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },
});
