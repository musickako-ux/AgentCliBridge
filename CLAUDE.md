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

```
src/index.ts                  Entry: loads config, starts adapters, watches config.yaml for hot reload
src/core/
  agent.ts                    Spawns `claude` CLI subprocess per request; streams JSON output
                              Retry up to 3x with endpoint rotation on 429/401/529
                              Resumes sessions via `-r <session_id>` flag
                              Exposes getRotator() and getIntentConfig() for adapters
  config.ts                   YAML config loader with env var fallback for single endpoint
                              Interfaces: Config, AgentConfig, IntentConfig, MemoryConfig, etc.
  intent.ts                   Hybrid natural language intent detection
                              regexDetect(): zero-cost regex matching (reminder/task/memory/forget/clear)
                              claudeDetect(): low-budget Claude fallback (~$0.005/call)
                              detectIntent(): hybrid entry (regex first, Claude fallback)
  keys.ts                     Round-robin endpoint rotation with 60s auto-cooldown on failure
  lock.ts                     Per-user concurrency mutex (Redis primary, in-memory fallback, 5min TTL)
  store.ts                    SQLite (WAL mode): sessions, usage, history, memories, tasks tables
  permissions.ts              Whitelist: allowed_users[] + allowed_groups[]; empty = allow all
  markdown.ts                 Standard markdown -> Telegram MarkdownV2 converter
  i18n.ts                     Internationalization (en/zh), t() helper with variable interpolation
src/adapters/
  base.ts                     Adapter interface + chunkText() utility
  telegram.ts                 Raw Telegram Bot API via fetch (long polling, not grammy)
  discord.ts                  discord.js -- responds to @mentions and DMs
```

### Key data flow

1. Adapter receives message -> checks `AccessControl.isAllowed(userId)`
2. Parses `/commands` (Telegram) or `!commands` (Discord)
3. Runs intent detection: `detectIntent(text, rotator, intentConfig)`
   - Regex match -> handle immediately (reminder/task/memory/forget/clear_session)
   - No match + claude fallback enabled -> Claude classifies intent
   - type "none" -> fall through to Claude conversation
4. Acquires `UserLock` (one concurrent request per user)
5. Calls `AgentEngine.runStream(userId, prompt, platform, onChunk)`
6. Agent spawns `claude` subprocess in user's workspace directory (`workspaces/<userId>/`)
7. Streams partial text back to adapter via callback; adapter edits message every 1.5s
8. On completion, stores session_id, records cost, saves history in SQLite

### Config

Primary config is `config.yaml` (gitignored, use `config.yaml.example` as template). Supports multiple endpoints (each with base_url, api_key, model), agent settings (allowed_tools, max_turns, budget, memory, intent), workspace isolation, platform toggles, and access whitelist. `.env` is fallback for single-endpoint setup.

### Platform commands

| Telegram | Discord | Action |
|----------|---------|--------|
| /new | !new | Clear session |
| /usage | !usage | Show user cost |
| /allusage | !allusage | Show all users cost |
| /history | !history | Show message history |
| /model | !model | Show current model |
| /reload | !reload | Hot reload config |
| /remember | !remember | Save a memory |
| /memories | !memories | List memories |
| /forget | !forget | Clear all memories |
| /task | !task | Add a task |
| /tasks | !tasks | List pending tasks |
| /done | !done | Complete a task |
| /remind | !remind | Set a timed reminder |
| /auto | !auto | Queue auto task |
| /autotasks | !autotasks | List auto tasks |
| /cancelauto | !cancelauto | Cancel auto task |

### Natural language intent (no command prefix needed)

Priority: commands > intent detection > Claude conversation

Supported intents (regex patterns, Chinese + English):
- **reminder**: "remind me 5 min later check server" / "提醒我5分钟后检查服务器"
- **task**: "add task buy milk" / "添加任务买牛奶"
- **memory**: "remember I like TypeScript" / "记住我喜欢TypeScript"
- **forget**: "forget all" / "忘记所有"
- **clear_session**: "new session" / "新会话"

Config: `agent.intent.enabled` (default true), `agent.intent.use_claude_fallback` (default true)

### Conventions

- ES Modules (`"type": "module"` in package.json, ESNext module target)
- Logging uses prefixed `console.log`: `[claudebridge]`, `[agent]`, `[telegram]`, `[discord]`
- File uploads go to `workspaces/<userId>/` for per-user isolation
- Telegram adapter uses raw fetch against Bot API (not grammy, despite it being a dependency)
- Sensitive config (`config.yaml`) is gitignored; `config.yaml.example` is the template
