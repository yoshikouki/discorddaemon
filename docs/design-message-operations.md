# Design: Message Operations CLI Commands

## Overview

Five new CLI subcommands under `ddd messages` that wrap Discord.js `MessageManager` and `Message` methods as thin, one-shot CLI operations. Each command connects to Discord, performs a single action, prints the result as NDJSON to stdout (where applicable), and disconnects.

The design principle: **a foundation model that knows the Discord API should predict ddd's CLI behavior without reading docs.**

---

## Transport

In v1, each CLI command establishes a one-shot Discord gateway connection (same pattern as `ddd channels`). This is pragmatic for the current usage. In v2 (per roadmap.md), CLI commands may delegate to the running daemon via IPC, reusing the authenticated client. The CLI interface (command signatures, flags, output schemas) is designed to be transport-agnostic.

---

## 1. Command Signatures

```
ddd messages list <channel_id> [flags]
ddd messages send <channel_id> [flags]
ddd messages edit <channel_id> <message_id> [flags]
ddd messages delete <channel_id> <message_id> [flags]
ddd messages react <channel_id> <message_id> <emoji> [flags]
```

All commands accept `-c / --config <path>` to specify the config file (for token resolution). No command requires the channel to be registered in the config; the config is only used for the bot token.

---

## 2. Detailed Command Specifications

### 2.1 `ddd messages list <channel_id>`

Fetches messages from a channel. Wraps `channel.messages.fetch(options)`.

**Flags:**

| Flag | Short | Type | Default | SDK mapping |
|------|-------|------|---------|-------------|
| `--limit` | `-n` | number | `50` | `FetchMessagesOptions.limit` |
| `--before` | | string | | `FetchMessagesOptions.before` |
| `--after` | | string | | `FetchMessagesOptions.after` |
| `--around` | | string | | `FetchMessagesOptions.around` |
| `--config` | `-c` | string | `~/.ddd/ddd.toml` | N/A |

`--before`, `--after`, and `--around` are mutually exclusive (Discord API constraint). If multiple are provided, exit with error.

Discord API caps `limit` at 100. Values above 100 or below 1 produce an error on stderr and exit 1.

**Output (NDJSON, one line per message, newest first):**

```jsonc
{
  "id": "123456789012345678",
  "content": "hello world",
  "author": {
    "id": "987654321098765432",
    "username": "alice",
    "bot": false
  },
  "channel": {
    "id": "111111111111111111",
    "name": "general"
  },
  "guild": {
    "id": "222222222222222222",
    "name": "My Server"
  },
  "timestamp": "2026-03-24T12:00:00.000Z",
  "editedTimestamp": null,
  "pinned": false,
  "type": 0
}
```

Field names use camelCase to mirror discord.js SDK property names (`message.editedTimestamp`, `message.author.username`), not the Discord REST API's snake_case.

This schema aligns with `HookInput.message` from `src/types.ts`, extended with `editedTimestamp`, `pinned`, and `type` fields.

**SDK mapping:**

```typescript
const channel = await client.channels.fetch(channelId);
// After fetching, the channel is validated as text-based.
// If the channel is null, a category, voice, or stage channel,
// the command exits with error: "Channel <id> is not a text channel".
const messages = await channel.messages.fetch({ limit, before, after, around });
```

**Required bot permissions:** `VIEW_CHANNEL`, `READ_MESSAGE_HISTORY`

### Data Caveats

If the bot lacks the `MESSAGE_CONTENT` privileged intent, `content` may be empty for messages not sent by the bot. This is a Discord platform constraint, not a ddd limitation.

---

### 2.2 `ddd messages send <channel_id>`

Sends a message to a channel. Wraps `channel.send(content)`.

**Flags:**

| Flag | Short | Type | Default | SDK mapping |
|------|-------|------|---------|-------------|
| `--content` | `-m` | string | | `MessageCreateOptions.content` |
| `--config` | `-c` | string | `~/.ddd/ddd.toml` | N/A |

**Content source priority:**
1. `--content "text"` flag
2. stdin (if not a TTY)

If neither is provided, exit with error. If both are provided, `--content` wins.

Reading from stdin enables piping: `echo "hello" | ddd messages send <channel_id>`.

**Output (NDJSON, single line):** Same schema as `messages list` output.

**SDK mapping:**

```typescript
const channel = await client.channels.fetch(channelId);
// After fetching, the channel is validated as text-based.
// If the channel is null, a category, voice, or stage channel,
// the command exits with error: "Channel <id> is not a text channel".
const message = await channel.send({ content });
```

**Required bot permissions:** `VIEW_CHANNEL`, `SEND_MESSAGES`

---

### 2.3 `ddd messages edit <channel_id> <message_id>`

Edits a message. Wraps `channel.messages.edit(messageId, options)`. The bot can only edit its own messages.

**Flags:**

| Flag | Short | Type | Default | SDK mapping |
|------|-------|------|---------|-------------|
| `--content` | `-m` | string | | `MessageEditOptions.content` |
| `--config` | `-c` | string | `~/.ddd/ddd.toml` | N/A |

**Content source:** Same priority as `send` (flag first, then stdin).

**Output (NDJSON, single line):** Same schema as `messages list` output (with `editedTimestamp` populated).

**SDK mapping:**

```typescript
const channel = await client.channels.fetch(channelId);
// After fetching, the channel is validated as text-based.
// If the channel is null, a category, voice, or stage channel,
// the command exits with error: "Channel <id> is not a text channel".
const message = await channel.messages.edit(messageId, { content });
```

**Required bot permissions:** `VIEW_CHANNEL`, `SEND_MESSAGES`

---

### 2.4 `ddd messages delete <channel_id> <message_id>`

Deletes a message. Wraps `channel.messages.delete(messageId)`.

**Flags:**

| Flag | Short | Type | Default |
|------|-------|------|---------|
| `--config` | `-c` | string | `~/.ddd/ddd.toml` |

**Output:** SDK returns `Promise<void>`. Following thin-wrapper principle, success produces no output and exit code 0.

**SDK mapping:**

```typescript
const channel = await client.channels.fetch(channelId);
// After fetching, the channel is validated as text-based.
// If the channel is null, a category, voice, or stage channel,
// the command exits with error: "Channel <id> is not a text channel".
await channel.messages.delete(messageId);
```

**Required bot permissions:** `VIEW_CHANNEL`, `MANAGE_MESSAGES` (for deleting others' messages; not required for deleting the bot's own messages)

---

### 2.5 `ddd messages react <channel_id> <message_id> <emoji>`

Adds a reaction to a message. Wraps `channel.messages.react(messageId, emoji)`.

**Flags:**

| Flag | Short | Type | Default |
|------|-------|------|---------|
| `--config` | `-c` | string | `~/.ddd/ddd.toml` |

**Emoji argument formats** (mirrors `EmojiIdentifierResolvable` from discord.js):
- Unicode emoji: `ddd messages react <ch> <msg> "👍"`
- Custom emoji: `ddd messages react <ch> <msg> "name:123456789"`

**Output:** SDK returns `Promise<void>`. Following thin-wrapper principle, success produces no output and exit code 0.

**SDK mapping:**

```typescript
const channel = await client.channels.fetch(channelId);
// After fetching, the channel is validated as text-based.
// If the channel is null, a category, voice, or stage channel,
// the command exits with error: "Channel <id> is not a text channel".
await channel.messages.react(messageId, emoji);
```

REST-based reaction creation does not require the `GatewayIntentBits.GuildMessageReactions` intent.

**Required bot permissions:** `VIEW_CHANNEL`, `READ_MESSAGE_HISTORY`, `ADD_REACTIONS`

---

## 3. Shared Message Schema

```typescript
export interface MessageInfo {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  channel: {
    id: string;
    name: string | null;
  };
  guild: {
    id: string;
    name: string;
  } | null;
  timestamp: string;
  editedTimestamp: string | null;
  pinned: boolean;
  type: number;
}
```

Field names use camelCase to mirror discord.js SDK property names (`message.editedTimestamp`, `message.author.username`), not the Discord REST API's snake_case.

A superset of `HookInput.message` -- first six fields are identical, with three additional fields. A shared `buildMessageInfo(message: Message): MessageInfo` function extracts these from a discord.js `Message` object.

`buildMessageInfo` should be the single source of truth for message serialization. `HookInput.message` in `src/daemon.ts` should be derived from `MessageInfo` (by picking the relevant subset), ensuring both stay in sync.

---

## 4. Error Handling

| Condition | stderr message | Exit code |
|-----------|---------------|-----------|
| Missing `<channel_id>` positional | `Usage: ddd messages <cmd> <channel_id> ...` | 1 |
| Missing `<message_id>` positional | `Usage: ddd messages <cmd> <channel_id> <message_id> ...` | 1 |
| Missing `<emoji>` positional (react) | `Usage: ddd messages react <channel_id> <message_id> <emoji>` | 1 |
| Channel is null or not text-based | `Channel <id> is not a text channel` | 1 |
| Missing content (send/edit) | `Content required: use --content or pipe to stdin` | 1 |
| Empty content after trim (send/edit) | `Content must not be empty` | 1 |
| `--limit` out of range (< 1 or > 100) | `Limit must be 1-100` | 1 |
| Mutually exclusive flags | `--before, --after, and --around are mutually exclusive` | 1 |
| Discord API errors | Error message forwarded | 1 |

All errors go to stderr with `[ddd]` prefix, no stack traces.

---

## 5. Architecture

### 5.1 File Structure

```
src/commands/
  messages.ts          # ddd messages list|send|edit|delete|react (dispatcher + all subcommands)
  messages.test.ts
src/
  discord.ts           # Shared: withDiscordClient helper
  message-info.ts      # MessageInfo type + buildMessageInfo helper
  index.ts             # Add messages command case
```

All message operations are under `ddd messages`, so a single `messages.ts` file acts as both dispatcher and implementation. Each subcommand is small enough that a single file keeps things simple and avoids over-structuring. If individual subcommands grow substantially, they can be extracted into a `messages/` directory later.

### 5.2 Shared Discord Client Helper (`src/discord.ts`)

```typescript
export async function withDiscordClient<T>(
  token: string,
  intents: GatewayIntentBits[],
  action: (client: Client<true>) => Promise<T>,
): Promise<T> {
  const client = new Client({ intents });
  try {
    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, () => resolve());
      client.once(Events.Error, reject);
      client.login(token).catch(reject);
    });
    return await action(client);
  } finally {
    client.destroy();
  }
}
```

### 5.3 DI Pattern

Each command follows `channels.ts` pattern: executor function as parameter with production default.

### 5.4 Stdin Reading (`src/stdin.ts`)

```typescript
export async function readStdin(): Promise<string | undefined> {
  if (Bun.stdin.isTTY) return undefined;
  const text = await new Response(Bun.stdin.stream()).text();
  const trimmed = text.trimEnd();
  return trimmed || undefined;
}
```

### 5.5 CLI Entrypoint (`src/index.ts`)

The `messages` command is registered as a single top-level command. The dispatcher in `messages.ts` parses the subcommand (`list`, `send`, `edit`, `delete`, `react`) from the remaining positional arguments.

---

## 6. Implementation Order

1. `src/discord.ts` -- shared `withDiscordClient` helper
2. `src/message-info.ts` -- `MessageInfo` type + `buildMessageInfo`
3. `src/commands/messages.ts` -- `ddd messages send` (most immediately useful for agents)
4. `src/commands/messages.ts` -- `ddd messages list` (pairs with send for send-then-read workflow)
5. `src/commands/messages.ts` -- `ddd messages edit` (structurally identical to send)
6. `src/commands/messages.ts` -- `ddd messages delete` (simplest subcommand)
7. `src/commands/messages.ts` -- `ddd messages react` (REST-only, no extra intents)
8. `src/index.ts` -- add `messages` command case, update USAGE

---

## 7. Design Decisions

- **No `--json` flag**: Always NDJSON to stdout (matches existing `channels` behavior)
- **`--content` / `-m`**: Long form mirrors `MessageCreateOptions.content`, short `-m` matches git convention
- **Positional `<channel_id>`**: Always required, keeps commands short
- **stdin for content**: UNIX composability (`echo "text" | ddd messages send <ch>`)
- **`type: number`**: Raw Discord `MessageType` enum value, SDK-mirrored
- **Gateway connection, not REST-only**: Consistency with existing codebase; future optimization possible
- **Resource-first subcommands**: `ddd messages <verb>` groups related operations under a single resource noun, keeping the top-level namespace clean as more resources are added
- **No output for void SDK calls**: `delete` and `react` wrap SDK methods that return `Promise<void>`, so success is expressed purely through exit code 0 with no stdout output

---

## 8. USAGE String

```
Usage: ddd <command>

Commands:
  start [-c path]                                        Start the daemon
  init                                                   Scaffold ~/.ddd/ddd.toml and hooks/
  channels [-c path]                                     List available Discord channels
  messages list <channel_id> [-n limit]                  Fetch messages from a channel
  messages send <channel_id> [-m content]                Send a message to a channel
  messages edit <channel_id> <message_id> [-m content]   Edit a message
  messages delete <channel_id> <message_id>              Delete a message
  messages react <channel_id> <message_id> <emoji>       Add a reaction to a message
```
