# Agent Rules Migration (Kiro Steering → AGENTS)

本文件说明历史 `.kiro/steering` 严格规则如何迁移到 `AGENTS.md` 体系。

## 生效入口

- 根规则：`AGENTS.md`
- 分层规则：
  - `apps/api/AGENTS.md`
  - `apps/admin/AGENTS.md`
  - `apps/miniprogram/AGENTS.md`

## 严格映射（全量逐字）

| 历史文件 | 迁移位置 |
|---|---|
| `.kiro/steering/juchang-rules.md` | `AGENTS.md` |
| `.kiro/steering/api-patterns.md` | `apps/api/AGENTS.md` |
| `.kiro/steering/admin-patterns.md` | `apps/admin/AGENTS.md` |
| `.kiro/steering/miniprogram-patterns.md` | `apps/miniprogram/AGENTS.md` |

## 维护约定

1. 以上四份规则以 `.kiro/steering` 为迁移来源，已全量逐字迁移至 AGENTS。
2. 非上述四份文档不纳入当前严格规则主链路。
3. 可选技能文档放在 `docs/agent-skills/**/SKILL.md`，仅作为执行清单，不覆盖硬规则。

## 当前可选 Skills（高价值最小集）

- `docs/agent-skills/ai-sdk-guardrails/SKILL.md`
- `docs/agent-skills/web-chat-ui/SKILL.md`
