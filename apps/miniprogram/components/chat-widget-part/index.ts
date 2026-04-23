export {}

interface WidgetPartDataState {
  dashboardNickname: string;
  dashboardGreeting: string;
  dashboardSubGreeting: string;
  dashboardSections: Record<string, unknown>[];
  dashboardActivities: Record<string, unknown>[];
  dashboardQuickPrompts: Record<string, unknown>[];
  dashboardUi: Record<string, unknown>;
  askPreferenceDisabled: boolean;
  actionChipsDisabled: boolean;
  partnerIntentFormDisabled: boolean;
  draftSettingsDisabled: boolean;
  errorMessage: string;
  errorRetryText: string;
  errorShowRetry: boolean;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    part: {
      type: Object,
      value: {},
    },
    userNickname: {
      type: String,
      value: '搭子',
    },
    isHistorical: {
      type: Boolean,
      value: false,
    },
    defaultErrorMessage: {
      type: String,
      value: '出了点问题',
    },
    defaultErrorRetryText: {
      type: String,
      value: '重试',
    },
  },

  data: {
    dashboardNickname: '搭子',
    dashboardGreeting: '',
    dashboardSubGreeting: '',
    dashboardSections: [],
    dashboardActivities: [],
    dashboardQuickPrompts: [],
    dashboardUi: {},
    askPreferenceDisabled: false,
    actionChipsDisabled: false,
    partnerIntentFormDisabled: false,
    draftSettingsDisabled: false,
    errorMessage: '出了点问题',
    errorRetryText: '重试',
    errorShowRetry: true,
  } as WidgetPartDataState,

  observers: {
    'part, userNickname, isHistorical, defaultErrorMessage, defaultErrorRetryText': function(
      part: Record<string, unknown>,
      userNickname: string,
      isHistorical: boolean,
      defaultErrorMessage: string,
      defaultErrorRetryText: string
    ) {
      const partData = part && typeof part === 'object' && part.data && typeof part.data === 'object'
        ? (part.data as Record<string, unknown>)
        : {}

      const disabled = partData.disabled === true || isHistorical
      const dashboardNickname = typeof partData.nickname === 'string' && partData.nickname.trim()
        ? partData.nickname
        : userNickname || '搭子'
      const errorMessage = typeof partData.message === 'string' && partData.message.trim()
        ? partData.message
        : defaultErrorMessage || '出了点问题'
      const errorShowRetry = partData.showRetry !== false
      const errorRetryText = typeof partData.retryText === 'string' && partData.retryText.trim()
        ? partData.retryText
        : defaultErrorRetryText || '重试'
      const dashboardGreeting = typeof partData.greeting === 'string' ? partData.greeting : ''
      const dashboardSubGreeting = typeof partData.subGreeting === 'string' ? partData.subGreeting : ''
      const dashboardSections = Array.isArray(partData.sections) ? partData.sections as Record<string, unknown>[] : []
      const dashboardActivities = Array.isArray(partData.activities) ? partData.activities as Record<string, unknown>[] : []
      const dashboardQuickPrompts = Array.isArray(partData.quickPrompts) ? partData.quickPrompts as Record<string, unknown>[] : []
      const dashboardUi = partData.ui && typeof partData.ui === 'object'
        ? partData.ui as Record<string, unknown>
        : {}

      this.setData({
        dashboardNickname,
        dashboardGreeting,
        dashboardSubGreeting,
        dashboardSections,
        dashboardActivities,
        dashboardQuickPrompts,
        dashboardUi,
        askPreferenceDisabled: disabled,
        actionChipsDisabled: disabled,
        partnerIntentFormDisabled: disabled,
        draftSettingsDisabled: disabled,
        errorMessage,
        errorRetryText,
        errorShowRetry,
      })
    },
  },

  methods: {
    reemit(eventName: string, detail: unknown) {
      this.triggerEvent(eventName, detail)
    },

    onDashboardActivityTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
      this.reemit('dashboardactivitytap', e.detail)
    },

    onDashboardPromptTap(e: WechatMiniprogram.CustomEvent<{ prompt: string }>) {
      this.reemit('dashboardprompttap', e.detail)
    },

    onDashboardQuickItemTap(e: WechatMiniprogram.CustomEvent<{ item: unknown }>) {
      this.reemit('dashboardquickitemtap', e.detail)
    },

    onDashboardPreferenceTap() {
      this.reemit('dashboardpreferencetap', {})
    },

    onDashboardViewAll() {
      this.reemit('dashboardviewall', {})
    },

    onWidgetActionTap(e: WechatMiniprogram.CustomEvent) {
      this.reemit('widgetactiontap', e.detail)
    },

    onWidgetShareTap(e: WechatMiniprogram.CustomEvent) {
      this.reemit('widgetsharetap', e.detail)
    },

    onWidgetShareViewDetail(e: WechatMiniprogram.CustomEvent) {
      this.reemit('widgetshareviewdetail', e.detail)
    },

    onExploreActivityTap(e: WechatMiniprogram.CustomEvent) {
      this.reemit('exploreactivitytap', e.detail)
    },

    onExploreActionTap(e: WechatMiniprogram.CustomEvent) {
      this.reemit('exploreactiontap', e.detail)
    },

    onExploreExpandMap(e: WechatMiniprogram.CustomEvent) {
      this.reemit('exploreexpandmap', e.detail)
    },

    onPartnerSearchActionTap(e: WechatMiniprogram.CustomEvent) {
      this.reemit('partnersearchactiontap', e.detail)
    },

    onAskPreferenceSelect(e: WechatMiniprogram.CustomEvent) {
      this.reemit('askpreferenceselect', e.detail)
    },

    onAskPreferenceSkip(e: WechatMiniprogram.CustomEvent) {
      this.reemit('askpreferenceskip', e.detail)
    },

    onActionChipTap(e: WechatMiniprogram.CustomEvent) {
      this.reemit('actionchiptap', e.detail)
    },

    onPartnerIntentFormSubmit(e: WechatMiniprogram.CustomEvent) {
      this.reemit('partnerintentformsubmit', e.detail)
    },

    onDraftSettingsFormSubmit(e: WechatMiniprogram.CustomEvent) {
      this.reemit('draftsettingsformsubmit', e.detail)
    },

    onAuthRequiredContinue(e: WechatMiniprogram.CustomEvent) {
      this.reemit('authrequiredcontinue', e.detail)
    },

    onWidgetErrorRetry(e: WechatMiniprogram.CustomEvent) {
      this.reemit('widgeterrorretry', e.detail)
    },
  },
})
