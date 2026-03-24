# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun run start            # Start daemon (reads ~/.config/ddd/ddd.toml)
bun run dev              # Start with --watch for development
bun test                 # Run all tests (bun:test)
bun test src/hook.test.ts  # Run a single test file
bun run check            # Lint/format check (ultracite + biome v2)
bun run fix              # Auto-fix lint/format issues
```

## Architecture

discorddaemon (ddd) is a Discord bot daemon that routes channel messages to external hook scripts. UNIX philosophy: the daemon handles Discord connectivity, hooks handle all business logic.

**Flow:** Discord message → daemon matches channel ID → spawns hook process → pipes message JSON to stdin → reads stdout as reply → sends reply to Discord.

### Key modules

- **`src/index.ts`** — CLI entrypoint. Parses args via `node:util` `parseArgs`, dispatches to commands.
- **`src/commands/start.ts`** — `ddd start [-c path]`. Loads config, creates daemon, installs signal handlers.
- **`src/commands/init.ts`** — `ddd init`. Scaffolds `~/.config/ddd/ddd.toml` and hooks.
- **`src/commands/channels.ts`** — `ddd channels [-c path]`. Lists available Discord text channels as NDJSON.
- **`src/daemon.ts`** — Discord.js Client lifecycle. Listens for `MessageCreate`, routes by channel ID, invokes hooks, sends replies.
- **`src/hook.ts`** — Hook executor. `Bun.spawn()` with native `timeout` and `AbortSignal` support.
- **`src/paths.ts`** — XDG Base Directory path resolution. Config → `$XDG_CONFIG_HOME/ddd/`, Data → `$XDG_DATA_HOME/ddd/`.
- **`src/config.ts`** — Loads config TOML via `Bun.file()` + `Bun.TOML.parse()`. Falls back to `DDD_TOKEN` env var. Hook paths resolve relative to config directory.
- **`src/types.ts`** — Shared interfaces: `Config`, `ChannelConfig`, `HookInput`, `HookResult`.

### Config format (~/.config/ddd/ddd.toml)

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

- **Bun runtime** — No Node.js or npm. Use `Bun.spawn`, `Bun.file`, `Bun.TOML.parse`, etc.
- **Ultracite + Biome v2** for linting/formatting — 2-space indent, double quotes. Pre-commit hook runs tests and auto-fixes.
- **Minimal dependencies** — Only runtime dependency is `discord.js`. TOML parsing uses `Bun.TOML.parse()`.
- **Test files** live alongside source as `*.test.ts`, using `bun:test`.
- **Logging** goes to stderr with `[ddd]` or `[hook]` prefix. Stdout is reserved for hook output.
