import { Client, Events, GatewayIntentBits } from "discord.js";
import type { Message } from "discord.js";
import { executeHook } from "./hooks.ts";
import type { ChannelConfig, HookInput } from "./types.ts";

export function createDaemon(
    token: string,
    channels: Record<string, ChannelConfig>,
) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });

    // Build channel ID → config lookup
    const channelMap = new Map<string, ChannelConfig & { name: string }>();
    for (const [name, config] of Object.entries(channels)) {
        channelMap.set(config.id, { ...config, name });
    }

    client.once(Events.ClientReady, (c) => {
        console.error(`[ddd] Logged in as ${c.user.tag}`);
        console.error(`[ddd] Watching ${channelMap.size} channel(s)`);
    });

    client.on(Events.MessageCreate, async (message: Message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        const channelConfig = channelMap.get(message.channelId);
        if (!channelConfig) return;

        const hookInput: HookInput = {
            id: message.id,
            channel_id: message.channelId,
            channel_name: channelConfig.name,
            author: {
                id: message.author.id,
                username: message.author.username,
                bot: message.author.bot,
            },
            content: message.content,
            timestamp: message.createdAt.toISOString(),
            attachments: message.attachments.map((a) => ({
                id: a.id,
                filename: a.name,
                url: a.url,
                size: a.size,
            })),
        };

        const result = await executeHook(channelConfig.on_message, hookInput);

        if (result.success && result.output) {
            try {
                await message.reply(result.output);
            } catch (err) {
                console.error(
                    `[ddd] Failed to reply in #${channelConfig.name}: ${err}`,
                );
            }
        }
    });

    return {
        start: () => client.login(token),
        stop: () => client.destroy(),
    };
}
