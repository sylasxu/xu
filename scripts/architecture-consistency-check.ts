#!/usr/bin/env bun

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Rule {
  name: string;
  regex: RegExp;
  appliesTo: (filePath: string) => boolean;
  hint: string;
}

function getTrackedFiles(): string[] {
  const output = execSync('git ls-files -z', { encoding: 'utf8' });
  return output
    .split('\0')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTextLikeFile(filePath: string): boolean {
  const nonTextExtensions = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.ico',
    '.pdf',
    '.zip',
    '.ttf',
    '.woff',
    '.woff2',
  ];
  return !nonTextExtensions.some((ext) => filePath.endsWith(ext));
}

const rules: Rule[] = [
  {
    name: 'forbid-activities-mine-route',
    regex: /\/activities\/mine\b/g,
    appliesTo: () => true,
    hint: '使用 `/activities/user/:userId`，不要使用 `/activities/mine`。',
  },
  {
    name: 'forbid-activities-me-route',
    regex: /\/activities\/me\b/g,
    appliesTo: () => true,
    hint: '使用 `/activities/user/:userId`，不要使用 `/activities/me`。',
  },
  {
    name: 'forbid-getActivitiesMine-symbol',
    regex: /\bgetActivitiesMine\b/g,
    appliesTo: () => true,
    hint: '使用 `getActivitiesUserByUserId`。',
  },
  {
    name: 'forbid-getActivitiesMe-symbol',
    regex: /\bgetActivitiesMe\b/g,
    appliesTo: () => true,
    hint: '使用 `getActivitiesUserByUserId`。',
  },
  {
    name: 'forbid-scope-query-in-ai-notifications',
    regex: /\bscope\b/g,
    appliesTo: (filePath) =>
      filePath.startsWith('apps/api/src/modules/ai/') ||
      filePath.startsWith('apps/api/src/modules/notifications/') ||
      filePath.startsWith('apps/miniprogram/src/api/endpoints/ai/') ||
      filePath.startsWith('apps/miniprogram/src/api/endpoints/notifications/') ||
      filePath.startsWith('apps/miniprogram/src/api/model/getAiConversations') ||
      filePath.startsWith('apps/miniprogram/src/api/model/aiConversationsQuery') ||
      filePath.startsWith('apps/miniprogram/src/api/model/getNotifications') ||
      filePath.startsWith('apps/miniprogram/src/api/model/notificationListQuery'),
    hint: '会话/通知查询统一使用显式 `userId` 参数，禁止 `scope`。',
  },
];

interface Violation {
  file: string;
  rule: string;
  hint: string;
}

const violations: Violation[] = [];

for (const relativePath of getTrackedFiles()) {
  if (!isTextLikeFile(relativePath)) {
    continue;
  }

  if (relativePath.includes('node_modules/')) {
    continue;
  }

  const absolutePath = resolve(relativePath);
  let content = '';
  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch {
    continue;
  }

  for (const rule of rules) {
    if (!rule.appliesTo(relativePath)) {
      continue;
    }

    rule.regex.lastIndex = 0;
    if (rule.regex.test(content)) {
      violations.push({
        file: relativePath,
        rule: rule.name,
        hint: rule.hint,
      });
    }
  }
}

const requiredChecks: Array<{ name: string; ok: boolean; hint: string }> = [
  {
    name: 'activities-user-route-exists',
    ok: readFileSync(resolve('apps/api/src/modules/activities/activity.controller.ts'), 'utf8').includes(
      "'/user/:userId'"
    ),
    hint: '活动查询必须保留 `/activities/user/:userId`。',
  },
  {
    name: 'ai-conversations-userid-check-exists',
    ok: readFileSync(resolve('apps/api/src/modules/ai/ai.controller.ts'), 'utf8').includes('缺少 userId 参数'),
    hint: 'AI 会话查询必须校验 `userId`。',
  },
  {
    name: 'notifications-userid-required',
    ok: readFileSync(resolve('apps/api/src/modules/notifications/notification.model.ts'), 'utf8').includes(
      "userId: t.String"
    ),
    hint: '通知查询参数必须强制 `userId`。',
  },
];

const failedRequired = requiredChecks.filter((item) => !item.ok);

if (violations.length === 0 && failedRequired.length === 0) {
  console.log('architecture-consistency-check passed.');
  process.exit(0);
}

console.error('architecture-consistency-check failed.\n');

if (violations.length > 0) {
  console.error('Forbidden patterns found:');
  for (const violation of violations) {
    console.error(`- [${violation.rule}] ${violation.file}`);
    console.error(`  hint: ${violation.hint}`);
  }
  console.error('');
}

if (failedRequired.length > 0) {
  console.error('Required architecture checks missing:');
  for (const item of failedRequired) {
    console.error(`- [${item.name}] ${item.hint}`);
  }
}

process.exit(1);
