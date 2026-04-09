/**
 * Thinking Bubble 组件 - AI 思考态
 * Requirements: 响应感
 * 
 * 使用场景：
 * - AI 解析时插入到 Chat Stream 底部
 * - 收到 AI 响应后移除
 */

interface ComponentData {
  // 无内部状态
}

interface ComponentProperties {
  text: WechatMiniprogram.Component.PropertyOption
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 可选的提示文字（如"正在思考..."）
    text: {
      type: String,
      value: '',
    },
  },

  data: {},

  methods: {},
})
