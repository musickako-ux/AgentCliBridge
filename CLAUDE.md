# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # tsc -> dist/
npm run dev            # tsx src/index.ts (hot reload watches config.yaml)
npm start              # node dist/index.js
```

No test framework is configured. No linter is configured.

## Architecture

ClaudeBridge bridges the `claude` CLI to chat platforms (Telegram, Discord). It does **not** use the Claude Agent SDK -- it spawns `claude` as a subprocess with `--output-format stream-json` and parses the JSON stream for text, session_id, and cost.

### Skill System (v0.2.0)

Instead of hardcoded commands and regex/Claude intent detection, ClaudeBridge injects a **skill document** into Claude's system prompt via `--append-system-prompt`. Claude naturally understands it's running inside ClaudeBridge and can manage memories, tasks, reminders, and auto-tasks by calling `claudebridge-ctl` through the Bash tool.

```
User: "提醒我5分钟后开会"
  → No intent interception
  → Enters Claude conversation
  → Claude reads skill doc, knows it has bridge capabilities
  → Claude calls: node /path/ctl.js reminder add <userId> <platform> <chatId> 5 "开会"
  → ctl writes to SQLite tasks table
  → Claude replies: "好的，5分钟后提醒你开会"
  → 5 min later, bridge's checkReminders() timer pushes notification
```

### File structure

```
src/index.ts                  Entry: loads config, starts adapters, watches config.yaml for hot reload
src/ctl.ts                    claudebridge-ctl CLI: standalone tool for memory/task/reminder/auto ops
                              Reads CLAUDEBRIDGE_DB env var, outputs JSON to stdout
                              Used by Claude via Bash tool during conversations
src/core/
  agent.ts                    Spawns `claude` CLI subprocess per request; streams JSON output
                              Retry up to 3x with endpoint rotation on 429/401/529
                              Resumes sessions via `-r <session_id>` flag
                              Injects skill doc + memories via --append-system-prompt
                              Sets CLAUDEBRIDGE_DB env for ctl access
  config.ts                   YAML config loader with env var fallback for single endpoint
                              Interfaces: Config, AgentConfig, SkillConfig, MemoryConfig, etc.
  keys.ts                     Round-robin endpoint rotation with 60s auto-cooldown on failure
  lock.ts                     Per-user concurrency mutex (Redis primary, in-memory fallback, 5min TTL)
  store.ts                    SQLite (WAL mode): sessions, usage, history, memories, tasks tables
  permissions.ts              Whitelist: allowed_users[] + allowed_groups[]; empty = allow all
  markdown.ts                 Standard markdown -> Telegram MarkdownV2 converter
  i18n.ts                     Internationalization (en/zh), t() helper with variable interpolation
src/skills/
  bridge.ts                   Generates skill document for Claude (bilingual zh/en)
                              Injects userId, chatId, platform, ctl absolute path
src/adapters/
  base.ts                     Adapter interface + chunkText() utility
  telegram.ts                 Raw Telegram Bot API via fetch (long polling, not grammy)
  discord.ts                  discord.js -- responds to @mentions and DMs
```

### Key data flow

1. Adapter receives message -> checks `AccessControl.isAllowed(userId)`
2. Parses `/commands` (Telegram) or `!commands` (Discord) for management commands
3. All other text -> sent directly to Claude conversation (no intent interception)
4. Acquires `UserLock` (one concurrent request per user)
5. Calls `AgentEngine.runStream(userId, prompt, platform, chatId, onChunk)`
6. Agent builds `--append-system-prompt` with user memories + skill document
7. Agent spawns `claude` subprocess with `CLAUDEBRIDGE_DB` env in user's workspace
8. Claude reads skill doc, can call `claudebridge-ctl` via Bash to manage memories/tasks/reminders
9. Streams partial text back to adapter via callback; adapter edits message every 1.5s
10. On completion, stores session_id, records cost, saves history in SQLite

### Config

Primary config is `config.yaml` (gitignored, use `config.yaml.example` as template). Supports multiple endpoints (each with base_url, api_key, model), agent settings (allowed_tools, max_turns, budget, memory, skill), workspace isolation, platform toggles, and access whitelist. `.env` is fallback for single-endpoint setup.

**Important**: `allowed_tools` must include `Bash` for the skill system to work (Claude needs Bash to call `claudebridge-ctl`).

### Platform commands (management only)

| Telegram | Discord | Action |
|----------|---------|--------|
| /start /help | !help | Show help |
| /new | !new | Clear session |
| /usage | !usage | Show user cost |
| /allusage | !allusage | Show all users cost |
| /history | !history | Show message history |
| /model | !model | Show current model |
| /reload | !reload | Hot reload config |

### Claude-managed features (via skill system)

These are handled naturally by Claude through conversation — no command prefix needed:

- **Memories**: "remember I like TypeScript" / "记住我喜欢TypeScript" → Claude calls `ctl memory add`
- **Tasks**: "add task buy milk" / "添加任务买牛奶" → Claude calls `ctl task add`
- **Reminders**: "remind me in 5 min" / "5分钟后提醒我" → Claude calls `ctl reminder add`
- **Auto tasks**: "auto-run daily report" → Claude calls `ctl auto add`

Config: `agent.skill.enabled` (default true)

### claudebridge-ctl CLI

Standalone CLI for direct SQLite operations. Used by Claude via Bash tool, or manually for debugging.

```bash
# Requires CLAUDEBRIDGE_DB env var
export CLAUDEBRIDGE_DB=./data/claudebridge.db

claudebridge-ctl memory add <user_id> <content>
claudebridge-ctl memory list <user_id>
claudebridge-ctl memory clear <user_id>
claudebridge-ctl task add <user_id> <platform> <chat_id> <description>
claudebridge-ctl task list <user_id>
claudebridge-ctl task done <task_id> <user_id>
claudebridge-ctl reminder add <user_id> <platform> <chat_id> <minutes> <description>
claudebridge-ctl reminder list <user_id>
claudebridge-ctl auto add <user_id> <platform> <chat_id> <description>
claudebridge-ctl auto list <user_id>
claudebridge-ctl auto cancel <task_id>
```

All commands output JSON to stdout. Errors go to stderr with exit code 1.

### Conventions

- ES Modules (`"type": "module"` in package.json, ESNext module target)
- Logging uses prefixed `console.log`: `[claudebridge]`, `[agent]`, `[telegram]`, `[discord]`
- File uploads go to `workspaces/<userId>/` for per-user isolation
- Telegram adapter uses raw fetch against Bot API (not grammy, despite it being a dependency)
- Sensitive config (`config.yaml`) is gitignored; `config.yaml.example` is the template
- SQLite uses WAL mode + `busy_timeout=5000` for safe concurrent access between bridge and ctl
