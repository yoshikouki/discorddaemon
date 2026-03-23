# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun run start            # Start daemon (reads ddd.toml)
bun run dev              # Start with --watch for development
bun run test             # Run all tests (vitest)
bun run test:coverage    # Run tests with coverage report
bunx vitest run src/cli.test.ts  # Run a single test file
bun run lint             # Lint with Biome
bun run format           # Auto-fix lint/format with Biome
```

## Architecture

discorddaemon (ddd) is a Discord bot daemon that routes channel messages to external hook scripts. UNIX philosophy: the daemon handles Discord connectivity, hooks handle all business logic.

**Flow:** Discord message → daemon matches channel ID → spawns hook process → pipes message JSON to stdin → reads stdout as reply → sends reply to Discord.

### Key modules

- **`src/index.ts`** — Entrypoint and CLI dispatcher. Parses args, loads config, creates daemon, installs signal handlers.
- **`src/daemon.ts`** — Discord.js client. Builds a channel ID → config lookup map, listens for `MessageCreate`, invokes hooks, sends replies.
- **`src/hooks.ts`** — Hook executor. Spawns hook as a subprocess via `Bun.spawn()`, pipes JSON to stdin, reads stdout/stderr, enforces 30s timeout.
- **`src/config.ts`** — Loads and validates `ddd.toml`. Falls back to `DDD_TOKEN` env var for the bot token.
- **`src/toml.ts`** — Minimal hand-written TOML parser (string values only, no arrays/numbers/booleans). Sufficient for ddd.toml's flat structure.
- **`src/types.ts`** — Shared interfaces: `Config`, `ChannelConfig`, `HookInput`, `HookResult`.
- **`src/cli.ts`** — CLI argument parser using `node:util` `parseArgs`. Commands: `start [-c path]`, `init`.

### Config format (ddd.toml)

```toml
[bot]
token = ""  # or set DDD_TOKEN env var

[channels.<name>]
id = "<discord_channel_id>"
on_message = "./hooks/<script>"
```

### Hook interface

Hooks are any executable. They receive a JSON message object on stdin and write plain text reply to stdout. Exit code 0 = success.

## Conventions

- **Bun runtime** — No Node.js or npm. Use `Bun.spawn`, `Bun.file`, etc.
- **Biome** for linting/formatting — 4-space indent, double quotes, recommended rules.
- **No external TOML/CLI libraries** — Both are hand-rolled to keep dependencies minimal (only `discord.js`).
- **Test files** live alongside source as `*.test.ts`, using `vitest`.
- **Logging** goes to stderr with `[ddd]` or `[hook]` prefix. Stdout is reserved for hook output.
