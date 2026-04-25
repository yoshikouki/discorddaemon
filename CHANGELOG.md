# Changelog

## Unreleased

- Extend `ddd channels` with `list`, `create`, `edit`, and `delete` subcommands over IPC with one-shot fallback
- Mark list output with `manageable` so agents can distinguish editable text/announcement channels from read-only thread/forum/media entries

## 0.1.0 (2026-04-07)

Initial public release.

- Discord daemon routes channel messages to external hook scripts
- Per-channel hook configuration via TOML (`~/.config/ddd/ddd.toml`)
- Wildcard channel matching via `[channels."*"]`
- `ddd init` scaffolds config and example hooks
- `ddd start` / `ddd stop` / `ddd status` daemon management
- `ddd channels` lists available channels as NDJSON
- `ddd messages` message operations
- IPC-based daemon communication via Unix domain socket
- Audit logging and stats tracking
- XDG Base Directory compliant paths
