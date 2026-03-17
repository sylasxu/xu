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

interface PathRule {
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
  {
    name: 'forbid-dashboard-api-module',
    regex: /\/dashboard\b|modules\/dashboard\/|dashboardController\b|dashboardModel\b/g,
    appliesTo: (filePath) =>
      filePath.startsWith('apps/api/src/') ||
      filePath.startsWith('apps/miniprogram/src/api/'),
    hint: '运营指标与平台概览统一归入 `/analytics`，不要新增 `/dashboard` API 或 dashboard 后端模块。',
  },
  {
    name: 'forbid-notifications-viewer-specific-service-split',
    regex: /\bgetNotificationsByUserId\b|\bgetAllNotifications\b/g,
    appliesTo: (filePath) =>
      filePath.startsWith('apps/api/src/modules/notifications/') ||
      filePath.startsWith('apps/miniprogram/src/api/endpoints/notifications/'),
    hint: '通知读取统一使用显式 `userId` + 权限校验，不要按查看者角色拆 service 或接口。',
  },
  {
    name: 'forbid-jest-vitest-stack',
    regex: /\bvitest\b|\bjest\b|@jest\/|\bts-jest\b|\bbabel-jest\b/g,
    appliesTo: (filePath) =>
      filePath === 'package.json' ||
      filePath === 'bun.lock' ||
      (
        (filePath.startsWith('apps/') || filePath.startsWith('packages/') || filePath.startsWith('scripts/')) &&
        (filePath.endsWith('.ts') ||
          filePath.endsWith('.tsx') ||
          filePath.endsWith('.js') ||
          filePath.endsWith('.mjs') ||
          filePath.endsWith('.cjs') ||
          filePath.endsWith('.json'))
      ),
    hint: '测试栈统一使用 Bun First，默认不要引入 Jest / Vitest。',
  },
];

const pathRules: PathRule[] = [
  {
    name: 'forbid-helper-path-name',
    regex: /(^|\/)(helpers?|Helpers?)(\/|\.|$)/g,
    appliesTo: (filePath) =>
      filePath.startsWith('apps/') || filePath.startsWith('packages/') || filePath.startsWith('scripts/'),
    hint: '禁止新增 `helper/helpers` 命名；请改成明确的领域或协议职责名。',
  },
];

interface Violation {
  file: string;
  rule: string;
  hint: string;
}

const violations: Violation[] = [];

for (const relativePath of getTrackedFiles()) {
  if (relativePath === 'scripts/architecture-consistency-check.ts') {
    continue;
  }

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

  for (const rule of pathRules) {
    if (!rule.appliesTo(relativePath)) {
      continue;
    }

    rule.regex.lastIndex = 0;
    if (rule.regex.test(relativePath)) {
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
    ok:
      readFileSync(resolve('apps/api/src/modules/ai/ai.model.ts'), 'utf8').includes("userId: t.String") &&
      readFileSync(resolve('apps/api/src/modules/ai/ai.controller.ts'), 'utf8').includes("user.id !== query.userId"),
    hint: 'AI 会话查询必须强制 `userId` 参数，并校验普通用户仅可访问本人。',
  },
  {
    name: 'notifications-userid-required',
    ok: readFileSync(resolve('apps/api/src/modules/notifications/notification.model.ts'), 'utf8').includes(
      "userId: t.String"
    ),
    hint: '通知查询参数必须强制 `userId`。',
  },
  {
    name: 'analytics-metrics-route-exists',
    ok: readFileSync(resolve('apps/api/src/modules/analytics/analytics.controller.ts'), 'utf8').includes(
      "'/metrics'"
    ),
    hint: '业务指标必须统一暴露为 `/analytics/metrics`。',
  },
  {
    name: 'analytics-platform-overview-route-exists',
    ok: readFileSync(resolve('apps/api/src/modules/analytics/analytics.controller.ts'), 'utf8').includes(
      "'/platform-overview'"
    ),
    hint: '平台概览必须统一暴露为 `/analytics/platform-overview`。',
  },
  {
    name: 'root-test-api-script-exists',
    ok: readFileSync(resolve('package.json'), 'utf8').includes('"test:api": "bun run --cwd apps/api test"'),
    hint: '根脚本必须暴露 `test:api`，统一入口跑 API bun test。',
  },
  {
    name: 'root-flow-regression-script-exists',
    ok: readFileSync(resolve('package.json'), 'utf8').includes('"regression:flow": "bun scripts/flow-regression.ts"'),
    hint: '根脚本必须暴露 `regression:flow`，统一跑用户主流程回归。',
  },
  {
    name: 'root-protocol-regression-script-exists',
    ok: readFileSync(resolve('package.json'), 'utf8').includes(
      '"regression:protocol": "bun scripts/chat-curl-regression.ts"'
    ),
    hint: '根脚本必须暴露 `regression:protocol`，统一跑 SSE / GenUI 黑盒协议回归。',
  },
  {
    name: 'root-release-gate-script-exists',
    ok: readFileSync(resolve('package.json'), 'utf8').includes('"release:gate": "bun scripts/release-gate.ts"'),
    hint: '根脚本必须暴露 `release:gate`，统一跑发布前门禁。',
  },
  {
    name: 'api-bun-test-script-exists',
    ok: readFileSync(resolve('apps/api/package.json'), 'utf8').includes('"test": "bun test"'),
    hint: 'API 包必须保留 `bun test` 作为默认测试入口。',
  },
  {
    name: 'protocol-suite-includes-snapshot',
    ok: readFileSync(resolve('scripts/chat-curl-regression.ts'), 'utf8').includes('scripts/genui-turns-snapshot.ts'),
    hint: '协议回归入口必须串上 GenUI snapshot regression。',
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
