export type CoreNotificationScene = 'activity_reminder' | 'discussion_reply' | 'post_activity';

export type NotificationTouchpointCopy = {
  title: string;
  content: string;
  serviceHint: string;
  pagePath: string;
  actionLabel: string;
};

function compactText(value: string, fallback = '待补充'): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function toTemplateValue(value: string, maxLength = 20): string {
  const normalized = compactText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
}

export function buildActivityReminderTouchpoint(params: {
  activityId: string;
  activityTitle: string;
  locationName: string;
}): NotificationTouchpointCopy {
  const title = compactText(params.activityTitle, '这场活动');
  const location = compactText(params.locationName, '待确认地点');

  return {
    title: '活动快开始了',
    content: `「${title}」还有 1 小时开始，地点：${location}。先看讨论区确认到场安排。`,
    serviceHint: `${location}，1 小时后开始`,
    pagePath: `subpackages/activity/discussion/index?id=${params.activityId}&entry=activity_reminder`,
    actionLabel: '看讨论安排',
  };
}

export function buildDiscussionReplyTouchpoint(params: {
  activityId: string;
  activityTitle: string;
  senderName: string;
  content: string;
}): NotificationTouchpointCopy {
  const title = compactText(params.activityTitle, '这场活动');
  const sender = compactText(params.senderName, '有人');
  const message = compactText(params.content, '在讨论区回应了你');

  return {
    title: '讨论区有人回应',
    content: `「${title}」里 ${sender} 回应了：${message}`,
    serviceHint: `${sender}：${message}`,
    pagePath: `subpackages/activity/discussion/index?id=${params.activityId}&entry=discussion_reply`,
    actionLabel: '进入讨论区',
  };
}

export function buildPostActivityTouchpoint(params: {
  activityId: string;
  activityTitle: string;
}): NotificationTouchpointCopy {
  const title = compactText(params.activityTitle, '这场活动');

  return {
    title: `补一下「${title}」的活动结果`,
    content: '这场活动已经结束了，先点一个真实反馈，再决定要不要复盘或继续再约。',
    serviceHint: '先补反馈，再决定复盘或再约',
    pagePath: `pages/message/index?focus=post_activity&activityId=${params.activityId}`,
    actionLabel: '补活动反馈',
  };
}
