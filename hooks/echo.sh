#!/usr/bin/env bash
# echo.sh — Sample hook: echoes back the message content
# stdin: JSON with message data
# stdout: reply text (empty = no reply)

set -euo pipefail

# Extract content from JSON stdin using bun
content=$(bun -e "
const chunks = [];
for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
}
const buf = Buffer.concat(chunks);
const data = JSON.parse(buf.toString());
process.stdout.write(data.content);
")

echo "$content"
