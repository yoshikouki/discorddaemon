# Roadmap

## v1 — Event reception (current)

Discord events flow one direction: from Discord into hook scripts.

```
Discord → daemon → hook (stdin/stdout)
```

The daemon listens for messages, routes them to hooks by channel, and sends hook output back as replies.

## v2 — Event emission

The reverse direction: external processes fire events into ddd, which translates them into Discord actions.

```
CLI / script → ddd → Discord
```

This enables use cases like:
- AI agents sending messages to Discord channels via CLI
- Cron jobs posting scheduled updates
- CI/CD pipelines notifying channels on deploy

The mechanism is TBD — candidates include a local socket, HTTP endpoint, or CLI subcommands that communicate with the running daemon.

## Future CLI expansion

As v2 lands, the CLI grows to cover more of the Discord SDK surface:
- Channel management (create, archive, set topic)
- Message operations (send, edit, delete, react)
- Guild queries (members, roles, permissions)

Each addition follows the same principle: thin wrapper, SDK naming, `--json` output.
