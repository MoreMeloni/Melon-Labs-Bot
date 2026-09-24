import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("Missing DISCORD_TOKEN. Add the bot token to Replit Secrets.");
}

const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the bot is online.");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(token);
  const guildId = process.env.DISCORD_GUILD_ID;
  const commandRoute = guildId
    ? Routes.applicationGuildCommands(readyClient.user.id, guildId)
    : Routes.applicationCommands(readyClient.user.id);

  try {
    const existingCommands = (await rest.get(commandRoute)) as {
      id: string;
      name: string;
      type: number;
    }[];
    const existingPing = existingCommands.find(
      (command) => command.name === pingCommand.name && command.type === 1,
    );

    if (existingPing) {
      const updateRoute = guildId
        ? Routes.applicationGuildCommand(
            readyClient.user.id,
            guildId,
            existingPing.id,
          )
        : Routes.applicationCommand(readyClient.user.id, existingPing.id);
      await rest.patch(updateRoute, { body: pingCommand.toJSON() });
    } else {
      await rest.post(commandRoute, { body: pingCommand.toJSON() });
    }

    console.info(
      `Connected as ${readyClient.user.tag}; /ping is registered ${
        guildId ? "for the development server" : "globally"
      }.`,
    );
  } catch (error) {
    console.error("Could not register the /ping command:", error);
    await client.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ping") {
    return;
  }

  await interaction.reply("Pong!");
});

client.login(token).catch((error: unknown) => {
  console.error("Discord login failed. Check the DISCORD_TOKEN secret.", error);
  process.exitCode = 1;
});

const shutdown = () => {
  client.destroy();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);