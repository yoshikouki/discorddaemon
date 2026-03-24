import {
  type Client,
  Client as DiscordClient,
  Events,
  type GatewayIntentBits,
} from "discord.js";

export async function withDiscordClient<T>(
  token: string,
  intents: GatewayIntentBits[],
  action: (client: Client<true>) => Promise<T>
): Promise<T> {
  const client = new DiscordClient({ intents });
  try {
    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, () => resolve());
      client.once(Events.Error, reject);
      client.login(token).catch(reject);
    });
    return await action(client as Client<true>);
  } finally {
    client.destroy();
  }
}
