export async function readStdin(): Promise<string | undefined> {
  if (Bun.stdin.isTTY) {
    return undefined;
  }
  const text = await new Response(Bun.stdin.stream()).text();
  const trimmed = text.trimEnd();
  return trimmed || undefined;
}
