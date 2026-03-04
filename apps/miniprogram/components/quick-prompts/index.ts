/**
 * 快捷入口组件
 * Requirements: 7.0 Welcome 页结构
 * v4.4 新增
 * 
 * 展示预设的快捷 Prompt 入口
 */

interface QuickPrompt {
  icon: string;
  text: string;
  prompt: string;
}

interface ComponentData {
  displayPrompts: QuickPrompt[];
  hasPrompts: boolean;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 快捷入口列表
    prompts: {
      type: Array,
      value: [] as QuickPrompt[],
    },
  },

  data: {
    displayPrompts: [] as QuickPrompt[],
    hasPrompts: false,
  } as ComponentData,

  observers: {
    'prompts': function(prompts: QuickPrompt[]) {
      this.setData({
        displayPrompts: prompts || [],
        hasPrompts: (prompts || []).length > 0,
      });
    },
  },

  methods: {
    // 点击快捷入口
    onPromptTap(e: WechatMiniprogram.TouchEvent) {
      const { prompt } = e.currentTarget.dataset as { prompt: QuickPrompt };
      this.triggerEvent('prompttap', { prompt: prompt.prompt, text: prompt.text });
    },
  },
});
