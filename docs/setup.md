# Setup Guide

Getting ddd up and running from scratch.

## 1. Create a Discord Bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name, and create
3. Go to **Bot** in the left menu
4. Click **Reset Token** and copy the token (you'll put this in `~/.ddd/ddd.toml`)
5. On the same page, under **Privileged Gateway Intents**, enable **Message Content Intent**

## 2. Invite the Bot to Your Server

1. Go to **OAuth2** → **URL Generator** in the left menu
2. Under **Scopes**, check `bot`
3. Under **Bot Permissions**, check:
   - Send Messages
   - Read Message History
4. Open the generated URL in your browser and select the server to add the bot to

## 3. Get the Channel ID

Use the CLI to list available channels:

```bash
ddd channels
```

Or manually: in Discord, go to **User Settings → Advanced → Developer Mode** (ON), then right-click the target channel → **Copy Channel ID**.

## 4. Initialize

```bash
ddd init
```

This creates `~/.ddd/ddd.toml` and `~/.ddd/hooks/echo.sh`.

## 5. Configure

Edit `~/.ddd/ddd.toml` with your token and channel ID:

```toml
[bot]
token = "YOUR_BOT_TOKEN"

[channels.general]
id = "123456789012345678"
on_message = "./hooks/echo.sh"
```

You can also set the token via the `DDD_TOKEN` environment variable:

```bash
export DDD_TOKEN="YOUR_BOT_TOKEN"
```

## 6. Start

```bash
ddd start           # normal start
ddd start -c path   # specify config file path
```

For development, auto-restart on file changes:

```bash
bun run dev
```

## 7. Verify

Send a message in the configured Discord channel. If `echo.sh` is working, the bot will echo your message back.
