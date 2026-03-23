# Vision

## Why discorddaemon exists

Discord bot frameworks force you to write business logic inside a framework. discorddaemon (ddd) takes a different path: it handles Discord connectivity as a daemon, and delegates all business logic to external hook scripts via stdin/stdout.

This project was born from a question: **what would Discord bot infrastructure look like if designed with UNIX philosophy for the AI agent era?**

## The daemon + hook model

The core idea is process isolation. Each Discord channel routes messages to its own hook — an independent process that can be written in any language, crash without taking down the daemon, and be swapped without a restart.

This is the same model as git hooks or CGI: the daemon is plumbing, hooks are porcelain.

## Discord SDK as a CLI

ddd also serves as a thin CLI wrapper around the Discord SDK. The CLI is designed to be consumed by AI agents: machine-readable `--json` output, no invented abstractions, naming that mirrors the SDK directly.

A foundation model that already knows the Discord API should be able to use ddd's CLI without learning anything new.
