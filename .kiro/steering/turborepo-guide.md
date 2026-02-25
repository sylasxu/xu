---
inclusion: fileMatch
fileMatchPattern: "turbo.json,**/turbo.json,**/package.json"
---

# Turborepo Monorepo Guide (Vercel)

> Source: vercel/turborepo/skills/turborepo
> 适用于 JuChang Turborepo monorepo 的构建配置

## Critical Rules

1. **DO NOT create Root Tasks** — Always create package tasks
2. Add scripts to each relevant package's `package.json`
3. Register the task in root `turbo.json`
4. Root `package.json` only contains `turbo run <task>` — never actual task logic
5. Use `turbo run` (not `turbo`) in package.json and CI

## Anti-Patterns

### Root Scripts Bypassing Turbo

```json
// ❌ bypasses turbo
{ "scripts": { "build": "bun build" } }

// ✅ delegates to turbo
{ "scripts": { "build": "turbo run build" } }
```

### Using `&&` to Chain Turbo Tasks

Don't chain turbo tasks with `&&`. Let turbo orchestrate.

### `prebuild` Scripts That Manually Build Dependencies

```json
// ❌ manually building dependencies
{ "scripts": { "prebuild": "cd ../../packages/types && bun run build" } }

// ✅ declare dependency, let turbo handle build order
// package.json: "@repo/types": "workspace:*"
// turbo.json: "build": { "dependsOn": ["^build"] }
```

### Root `.env` File

A `.env` at repo root is an anti-pattern. Put `.env` files in packages that need them.

### Shared Code in Apps

```
// ❌ Shared code inside an app
apps/web/shared/utils.ts

// ✅ Extract to a package
packages/utils/src/utils.ts
```

### Accessing Files Across Package Boundaries

```typescript
// ❌ Reaching into another package's internals
import { Button } from "../../packages/ui/src/button";

// ✅ Install and import properly
import { Button } from "@repo/ui/button";
```

### Too Many Root Dependencies

```json
// ❌ App dependencies in root
{ "dependencies": { "react": "^18" } }

// ✅ Only repo tools in root
{ "devDependencies": { "turbo": "latest" } }
```

## `dependsOn` Syntax

```json
{
  "tasks": {
    // ^build = run build in DEPENDENCIES first (other packages)
    "build": { "dependsOn": ["^build"] },
    // build (no ^) = run build in SAME PACKAGE first
    "test": { "dependsOn": ["build"] },
    // pkg#task = specific package's task
    "deploy": { "dependsOn": ["web#build"] }
  }
}
```

## Common Task Configurations

### Standard Build Pipeline

```json
{
  "$schema": "https://turborepo.dev/schema.v2.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": { "cache": false, "persistent": true }
  }
}
```

### With Environment Variables

```json
{
  "globalEnv": ["NODE_ENV"],
  "globalDependencies": [".env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "env": ["API_URL", "DATABASE_URL"]
    }
  }
}
```

### Common Outputs by Framework

- Vite/Rollup: `["dist/**"]`
- Next.js: `[".next/**", "!.next/cache/**"]`
- tsc: `["dist/**"]` or custom `outDir`

## Environment Variables

- `.env` files must be in `inputs` for cache invalidation
- Framework vars (e.g., `VITE_*`) are auto-included via inference
- Use `globalEnv` for vars shared across all tasks
- Use task-level `env` for task-specific vars

```json
{
  "tasks": {
    "build": {
      "env": ["API_URL"],
      "inputs": ["$TURBO_DEFAULT$", ".env", ".env.*"]
    }
  }
}
```

## Package Configurations

Use per-package `turbo.json` instead of `package#task` overrides in root:

```json
// packages/web/turbo.json
{
  "extends": ["//"],
  "tasks": {
    "build": { "outputs": ["dist/**"] }
  }
}
```

## Filtering

- `--affected` — Run only changed packages + dependents (recommended)
- `--filter=web` — By package name
- `--filter=./apps/*` — By directory
- `--filter=web...` — Package + dependencies
- `--filter=...web` — Package + dependents

## Transit Nodes for Parallel Tasks

Tasks that need parallel execution with correct cache invalidation:

```json
{
  "tasks": {
    "transit": { "dependsOn": ["^transit"] },
    "lint": { "dependsOn": ["transit"] }
  }
}
```
