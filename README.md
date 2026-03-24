# discorddaemon (ddd)

Discord daemon with per-channel hooks. UNIX philosophy for Discord bots.

**One daemon, many hooks.** Each Discord channel routes to its own script. Your hook receives a message on stdin, writes a reply to stdout. That's it.

## Install

```bash
bun install -g discorddaemon
```

## Quick Start

> **First time?** See the [Setup Guide](docs/setup.md) for step-by-step instructions from bot creation to channel configuration.

1. Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications) and grab the token.

2. Create `ddd.toml`:

```toml
[bot]
token = ""  # or set DDD_TOKEN env var

[channels.general]
id = "CHANNEL_ID_HERE"
on_message = "./hooks/echo.sh"
```

3. Start the daemon:

```bash
ddd start
```

## Hook Interface

Hooks are **any executable**. Shell scripts, Python, Rust binaries — anything that reads stdin and writes stdout.

### Input (stdin)

```json
{
  "id": "message_id",
  "channel_id": "123456",
  "channel_name": "general",
  "author": {
    "id": "user_id",
    "username": "someone",
    "bot": false
  },
  "content": "hello world",
  "timestamp": "2026-03-23T12:00:00.000Z",
  "attachments": []
}
```

### Output (stdout)

Plain text. If non-empty, sent as a reply. If empty, nothing happens.

### Exit codes

- `0` — success
- non-zero — error logged to stderr

### Timeout

30 seconds by default.

## Example Hook

```bash
#!/usr/bin/env bash
# echo.sh — echoes back the message content
jq -r '.content' | sed 's/^/echo: /'
```

## Design Philosophy

- **One tool, one job.** ddd connects to Discord. Your hooks do everything else.
- **Text streams as interface.** stdin JSON in, stdout text out. Composable with any language.
- **No framework lock-in.** Hooks are processes, not plugins. Swap them without restarting.

## License

MIT
