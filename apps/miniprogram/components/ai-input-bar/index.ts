/**
 * AI 输入栏组件
 * Requirements: 2.1, 2.2, 2.5, 2.6
 * 
 * 底部悬浮的 AI 入口，整合搜索与创建功能
 * - 位置：Tabbar上方悬浮
 * - 外观：类似灵动岛的黑色长条
 * - 左侧：AI图标
 * - 中间：提示文案/输入框
 * - 右侧：语音按钮
 */

// 防抖定时器
let debounceTimer: number | null = null;
// 录音计时器
let recordingTimer: number | null = null;

// 防抖延迟时间 (ms) - Requirements: 2.6
const DEBOUNCE_DELAY = 500;

interface AiInputBarData {
  isExpanded: boolean;
  inputValue: string;
  isRecording: boolean;
  recordingDuration: number;
  placeholder: string;
}

interface AiInputBarProperties {
  placeholder: WechatMiniprogram.Component.PropertyOption;
  prefillText: WechatMiniprogram.Component.PropertyOption;
  prefillType: WechatMiniprogram.Component.PropertyOption;
  prefillLocation: WechatMiniprogram.Component.PropertyOption;
}

function readAiInputString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readAiInputLocation(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : [];
}

const AI_INPUT_BAR_DATA: AiInputBarData = {
  isExpanded: false,
  inputValue: '',
  isRecording: false,
  recordingDuration: 0,
  placeholder: '本周想玩什么...',
};

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 提示文案
    placeholder: {
      type: String,
      value: '本周想玩什么...',
    },
    // 预填文本（从幽灵锚点等场景传入）
    prefillText: {
      type: String,
      value: '',
    },
    // 预填活动类型
    prefillType: {
      type: String,
      value: '',
    },
    // 预填位置 [lng, lat]
    prefillLocation: {
      type: Array,
      value: [],
    },
  },

  data: {
    ...AI_INPUT_BAR_DATA,
  },

  lifetimes: {
    attached() {
      // 如果有预填文本，自动展开并填入
      const prefillText = readAiInputString(this.properties.prefillText) || '';
      if (prefillText) {
        this.setData({
          isExpanded: true,
          inputValue: prefillText,
        });
      }
    },

    detached() {
      // 清理防抖定时器
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      // 清理录音定时器
      if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
      }
    },
  },

  methods: {
    /**
     * 点击输入栏展开 - Requirements: 2.2
     */
    onBarTap() {
      if (!this.data.isExpanded) {
        this.setData({ isExpanded: true });
        this.triggerEvent('expand');
      }
    },

    /**
     * 输入框聚焦
     */
    onInputFocus() {
      this.setData({ isExpanded: true });
    },

    /**
     * 输入框失焦
     */
    onInputBlur() {
      // 如果输入框为空，收起
      if (!this.data.inputValue.trim()) {
        this.setData({ isExpanded: false });
        this.triggerEvent('collapse');
      }
    },

    /**
     * 输入内容变化 - Requirements: 2.3, 2.6
     */
    onInputChange(e: WechatMiniprogram.Input) {
      const value = e.detail.value;
      this.setData({ inputValue: value });

      // 清除之前的防抖定时器
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // 如果输入为空，不触发解析
      if (!value.trim()) {
        return;
      }

      // 防抖：500ms 后触发输入提示事件 - Requirements: 2.6
      debounceTimer = Number(setTimeout(() => {
        this.emitInputAssist(value);
      }, DEBOUNCE_DELAY));
    },

    /**
     * 触发输入提示事件
     */
    emitInputAssist(text: string) {
      const prefillType = readAiInputString(this.properties.prefillType) || '';
      const prefillLocation = readAiInputLocation(this.properties.prefillLocation);
      this.triggerEvent('assist', {
        text,
        prefillType,
        prefillLocation,
      });
    },

    /**
     * 确认输入（按回车或点击发送）
     */
    onInputConfirm() {
      const value = this.data.inputValue.trim();
      if (!value) return;

      // 清除防抖定时器，立即触发
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      this.emitInputAssist(value);
    },

    /**
     * 点击语音按钮 - Requirements: 2.5
     */
    onVoiceTap() {
      if (this.data.isRecording) {
        this.stopRecording();
      } else {
        this.startRecording();
      }
    },

    /**
     * 开始录音 - Requirements: 2.5
     */
    async startRecording() {
      try {
        // 检查录音权限
        const setting = await wx.getSetting();
        if (!setting.authSetting['scope.record']) {
          await wx.authorize({ scope: 'scope.record' });
        }

        this.setData({ isRecording: true, recordingDuration: 0 });

        // 创建录音管理器
        const recorderManager = wx.getRecorderManager();

        recorderManager.onStart(() => {
          console.log('录音开始');
          // 开始计时
          this.startRecordingTimer();
        });

        recorderManager.onStop((res) => {
          console.log('录音结束', res);
          this.setData({ isRecording: false });
          this.stopRecordingTimer();

          // 调用语音识别
          this.recognizeVoice(res.tempFilePath);
        });

        recorderManager.onError((err) => {
          console.error('录音错误', err);
          this.setData({ isRecording: false });
          this.stopRecordingTimer();
          wx.showToast({ title: '录音失败', icon: 'none' });
        });

        // 开始录音
        recorderManager.start({
          duration: 60000, // 最长60秒
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'mp3',
        });
      } catch (error) {
        console.error('录音权限获取失败', error);
        wx.showModal({
          title: '需要录音权限',
          content: '请在设置中开启录音权限以使用语音输入',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          },
        });
      }
    },

    /**
     * 停止录音
     */
    stopRecording() {
      const recorderManager = wx.getRecorderManager();
      recorderManager.stop();
    },

    startRecordingTimer() {
      recordingTimer = Number(setInterval(() => {
        this.setData({
          recordingDuration: this.data.recordingDuration + 1,
        });
      }, 1000));
    },

    stopRecordingTimer() {
      if (recordingTimer !== null) {
        clearInterval(recordingTimer);
        recordingTimer = null;
      }
    },

    /**
     * 语音识别 - Requirements: 2.5
     */
    async recognizeVoice(filePath: string) {
      wx.showLoading({ title: '识别中...' });

      try {
        // 使用微信语音识别插件或后端 API
        // 这里使用微信同声传译插件
        const plugin = requirePlugin('WechatSI');
        
        plugin.manager.translate({
          lfrom: 'zh_CN',
          lto: 'zh_CN',
          content: filePath,
          tts: false,
          success: (res: { retcode: number; result: string }) => {
            wx.hideLoading();
            if (res.retcode === 0 && res.result) {
              // 将识别结果填入输入框
              this.setData({
                inputValue: res.result,
                isExpanded: true,
              });
              // 触发输入提示事件
              this.emitInputAssist(res.result);
            } else {
              wx.showToast({ title: '识别失败，请重试', icon: 'none' });
            }
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '识别失败，请重试', icon: 'none' });
          },
        });
      } catch (error) {
        wx.hideLoading();
        console.error('语音识别失败', error);
        // 降级方案：提示用户手动输入
        wx.showToast({ title: '语音识别暂不可用', icon: 'none' });
      }
    },

    /**
     * 清空输入
     */
    onClearTap() {
      this.setData({ inputValue: '' });
      
      // 清除防抖定时器
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },

    /**
     * 收起输入栏
     */
    collapse() {
      this.setData({
        isExpanded: false,
        inputValue: '',
      });
      this.triggerEvent('collapse');
    },

    /**
     * 设置预填数据（供外部调用）
     */
    setPrefillData(data: { text?: string; type?: string; location?: number[] }) {
      const updates: Partial<AiInputBarData> = { isExpanded: true };
      
      if (data.text) {
        updates.inputValue = data.text;
      }
      
      this.setData(updates);
      
      if (data.type) {
        this.setData({ prefillType: data.type });
      }
      
      if (data.location) {
        this.setData({ prefillLocation: data.location });
      }
    },
  },
});
