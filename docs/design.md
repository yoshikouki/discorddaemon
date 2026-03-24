# Design Decisions

## Minimal dependencies

ddd's only runtime dependency is discord.js. TOML parsing uses Bun's built-in `Bun.TOML.parse()` and CLI argument parsing uses Node.js's built-in `node:util` `parseArgs`. No external libraries for either — the runtime provides everything needed.

## CLI designed for AI agents

The CLI is a thin wrapper over the Discord SDK, not an opinionated abstraction layer.

- **NDJSON by default**: All command output is NDJSON (one JSON object per line). There is no human-readable mode and no `--json` flag — machine consumption is the default and only mode.
- **SDK-mirrored naming**: Command names, flag names, and field names match Discord SDK terminology. No invented aliases.
- **No hidden magic**: A foundation model that knows the Discord API should predict ddd's CLI behavior without reading docs.

The anti-goal is "developer ergonomics" that comes at the cost of predictability. Short aliases and clever defaults make CLIs pleasant for humans but opaque to agents. Short flag forms (e.g., `-n` for `--limit`, `-m` for `--content`) are acceptable when the long form mirrors SDK naming and the short form follows widespread CLI convention.

## Hooks are processes, not plugins

Hooks are spawned as subprocesses, not loaded as modules. This is deliberate:

- **Crash isolation**: A broken hook cannot crash the daemon or other hooks.
- **Language freedom**: Any executable works. Shell, Python, Rust, a compiled binary.
- **Hot swap**: Replace a hook script and the next message uses the new version. No daemon restart.
- **Composability**: Hooks can be piped, chained, or wrapped with standard UNIX tools.

The cost is per-message process spawn overhead. For Discord bot workloads (human-speed message rates), this is negligible.
