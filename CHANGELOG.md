# Changelog

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
