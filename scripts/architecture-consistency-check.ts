#!/usr/bin/env bun

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  {
    name: 'forbid-legacy-ai-content-route-reference',
    regex: /\/ai\/generate\/content\b/g,
    appliesTo: () => true,
    hint: '旧 `/ai/generate/content` 已删除；仓库里不应再残留该路径或兼容别名引用。',
  },
  {
    name: 'forbid-admin-login-route-reference',
    regex: /\/auth\/admin\/login\b/g,
    appliesTo: () => true,
    hint: '认证接口统一使用 `/auth/login`；禁止恢复按端拆分的 `/auth/admin/login`。',
  },
  {
    name: 'forbid-legacy-kimi-k2-32k-reference',
    regex: /\bkimi-k2-32k\b/g,
    appliesTo: () => true,
    hint: 'Kimi 旧型号 `kimi-k2-32k` 已停用；统一改为 `kimi-k2.5` / `kimi-k2-thinking`。',
  },
  {
    name: 'forbid-qwen-chat-rerank-vision-models',
    regex: /\bqwen-flash\b|\bqwen-plus\b|\bqwen3-max\b|\bqwen-vl-max\b|\bqwen3-rerank\b/g,
    appliesTo: () => true,
    hint: 'Qwen 现在只保留 `text-embedding-v4`；禁止再引入 qwen chat / vision / rerank 型号。',
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
    name: 'content-generate-route-exists',
    ok:
      readFileSync(resolve('apps/api/src/modules/content/content.controller.ts'), 'utf8').includes("'/generate'") &&
      readFileSync(resolve('apps/api/src/modules/content/content.controller.ts'), 'utf8').includes("'/topic-suggestions'"),
    hint: '内容生成主路径必须统一暴露为 `/content/generate` 与 `/content/topic-suggestions`。',
  },
  {
    name: 'legacy-ai-content-route-removed',
    ok: (() => {
      const aiControllerContent = readFileSync(resolve('apps/api/src/modules/ai/ai.controller.ts'), 'utf8');
      const aiServiceContent = readFileSync(resolve('apps/api/src/modules/ai/ai.service.ts'), 'utf8');
      const aiModelContent = readFileSync(resolve('apps/api/src/modules/ai/ai.model.ts'), 'utf8');
      return !aiControllerContent.includes("'/generate/content'")
        && !aiServiceContent.includes('export async function generateContent(')
        && !aiModelContent.includes("'ai.contentGenerationRequest'")
        && !aiModelContent.includes("'ai.contentGenerationResponse'");
    })(),
    hint: '旧 `/ai/generate/content` 路由、兼容 service 和遗留 schema 必须全部删除干净。',
  },
  {
    name: 'admin-primary-nav-is-lean',
    ok: (() => {
      const sidebarContent = readFileSync(resolve('apps/admin/src/components/layout/data/sidebar-data.ts'), 'utf8');
      const requiredGroupTitles = [
        "title: '概览'",
        "title: '内容'",
        "title: '组局'",
        "title: '风控'",
        "title: 'AI'",
        "title: '设置'",
      ];
      const requiredEntries = [
        "url: '/'",
        "url: '/content'",
        "url: '/activities'",
        "url: '/safety/moderation'",
        "url: '/ai-ops/playground'",
        "url: '/ai-ops/conversations'",
        "url: '/ai-ops/config'",
        "url: '/ai-ops/usage'",
        "url: '/users'",
        "url: '/settings'",
      ];
      return requiredGroupTitles.every((snippet) => sidebarContent.includes(snippet))
        && requiredEntries.every((snippet) => sidebarContent.includes(snippet))
        && !sidebarContent.includes("title: '运营主线'");
    })(),
    hint: 'Admin 侧边栏必须按 `概览 / 内容 / 组局 / 风控 / AI / 设置` 分组，且不要再保留旧的 `运营主线` 单组结构。',
  },
  {
    name: 'protocol-regression-defaults-to-kimi',
    ok: (() => {
      const protocolRegressionContent = readFileSync(resolve('scripts/chat-regression.ts'), 'utf8');
      return protocolRegressionContent.includes("moonshot/kimi-k2.5")
        && !protocolRegressionContent.includes("model: 'qwen-plus'");
    })(),
    hint: '协议回归默认模型和显式模型覆盖都必须使用 Kimi 主链路，禁止再写 `qwen-plus`。',
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
      '"regression:protocol": "bun scripts/chat-regression.ts --suite core"'
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
    name: 'protocol-regression-script-exists',
    ok: existsSync(resolve('scripts/chat-regression.ts')),
    hint: '协议回归入口脚本 `scripts/chat-regression.ts` 必须存在。',
  },
  {
    name: 'protocol-snapshot-script-exists',
    ok: readFileSync(resolve('package.json'), 'utf8').includes(
      '"regression:protocol:snapshot": "bun scripts/genui-turns-snapshot.ts"'
    ),
    hint: 'GenUI snapshot regression 必须保留单独入口，供手动或专项回归使用。',
  },
  {
    name: 'ai-top-level-service-purity',
    ok: (() => {
      const topLevelEntries = readdirSync(resolve('apps/api/src/modules/ai'), { withFileTypes: true });
      const topLevelServiceFiles = topLevelEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.service.ts'))
        .map((entry) => entry.name);
      return topLevelServiceFiles.length === 1 && topLevelServiceFiles[0] === 'ai.service.ts';
    })(),
    hint: 'AI 顶层只能保留 `ai.service.ts` 作为 service 主门面；其他实现请下沉到子目录。',
  },
  {
    name: 'ai-controller-depends-on-ai-service-only',
    ok: (() => {
      const controllerContent = readFileSync(resolve('apps/api/src/modules/ai/ai.controller.ts'), 'utf8');
      const forbiddenImports = [
        "from './prompts'",
        "from './observability/metrics'",
        "from './task-runtime/agent-task.service'",
        "from './runtime/chat-response'",
        "from './runtime/response-policy'",
        "from './models/provider-error'",
      ];
      return forbiddenImports.every((snippet) => !controllerContent.includes(snippet));
    })(),
    hint: '`ai.controller.ts` 应通过 `ai.service.ts` 获取 AI 主链路能力，不要直连 runtime/prompt/task/metrics 细节。',
  },
];

const failedRequired = requiredChecks.filter((item) => !item.ok);
const releaseGateContent = readFileSync(resolve('scripts/release-gate.ts'), 'utf8');
const releaseGateViolations: Array<{ name: string; hint: string }> = [];

if (releaseGateContent.includes('test:pbt')) {
  releaseGateViolations.push({
    name: 'release-gate-should-not-run-property-tests',
    hint: '默认 release gate 不应再强绑 API property tests；高成本规则测试应单独按需执行。',
  });
}

if (
  releaseGateContent.includes("apps/miniprogram', 'test'")
  || releaseGateContent.includes('Mini program test gate')
) {
  releaseGateViolations.push({
    name: 'release-gate-should-not-run-miniprogram-test-gate',
    hint: '默认 release gate 不应再强绑小程序 test gate；主门禁统一收口到 type-check / test:api / flow / protocol。',
  });
}

if (violations.length === 0 && failedRequired.length === 0 && releaseGateViolations.length === 0) {
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

if (releaseGateViolations.length > 0) {
  console.error('\nRelease gate drift detected:');
  for (const item of releaseGateViolations) {
    console.error(`- [${item.name}] ${item.hint}`);
  }
}

process.exit(1);
