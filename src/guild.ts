import type { Collection, Guild } from "discord.js";

/**
 * Resolve guild ID from a Discord guild cache.
 * Throws if no guilds or multiple guilds are found.
 */
export function resolveGuildFromCache(
  guilds: Collection<string, Guild>
): string {
  if (guilds.size === 0) {
    throw new Error("Bot is not in any guild");
  }
  if (guilds.size === 1) {
    const first = guilds.first();
    if (!first) {
      throw new Error("Bot is not in any guild");
    }
    return first.id;
  }
  const list = guilds
    .map((g) => `  ${g.id} ${g.name}`)
    .toJSON()
    .join("\n");
  throw new Error(
    `Multiple guilds found. Specify guild_id or set default_guild in config:\n${list}`
  );
}
