# Design Decisions

## No external TOML/CLI libraries

ddd's only runtime dependency is discord.js. The TOML parser and CLI argument parser are hand-rolled — not because NIH, but because ddd.toml is flat key-value pairs and the CLI surface is small. Adding a library would increase the dependency surface for negligible gain.

If the config format or CLI complexity outgrows the hand-rolled implementations, this decision should be revisited.

## CLI designed for AI agents

The CLI is a thin wrapper over the Discord SDK, not an opinionated abstraction layer.

- **`--json` output**: Every command that produces output supports `--json` for machine consumption.
- **SDK-mirrored naming**: Command names, flag names, and field names match Discord SDK terminology. No invented aliases.
- **No hidden magic**: A foundation model that knows the Discord API should predict ddd's CLI behavior without reading docs.

The anti-goal is "developer ergonomics" that comes at the cost of predictability. Short aliases and clever defaults make CLIs pleasant for humans but opaque to agents.

## Hooks are processes, not plugins

Hooks are spawned as subprocesses, not loaded as modules. This is deliberate:

- **Crash isolation**: A broken hook cannot crash the daemon or other hooks.
- **Language freedom**: Any executable works. Shell, Python, Rust, a compiled binary.
- **Hot swap**: Replace a hook script and the next message uses the new version. No daemon restart.
- **Composability**: Hooks can be piped, chained, or wrapped with standard UNIX tools.

The cost is per-message process spawn overhead. For Discord bot workloads (human-speed message rates), this is negligible.
