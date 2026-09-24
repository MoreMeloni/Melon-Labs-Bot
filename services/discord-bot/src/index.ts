import {
  ApplicationCommandType,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import {
  handleTicketButton,
  handleTicketCommand,
} from "./tickets/handler.js";
import { ticketCommand } from "./tickets/commands.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("Missing DISCORD_TOKEN. Add the bot token to Replit Secrets.");
}

const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the bot is online.");

const applicationCommands = [pingCommand, ticketCommand];

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

    for (const command of applicationCommands) {
      const commandData = command.toJSON();
      const existingCommand = existingCommands.find(
        (registered) =>
          registered.name === commandData.name &&
          registered.type === ApplicationCommandType.ChatInput,
      );

      if (existingCommand) {
        const updateRoute = guildId
          ? Routes.applicationGuildCommand(
              readyClient.user.id,
              guildId,
              existingCommand.id,
            )
          : Routes.applicationCommand(readyClient.user.id, existingCommand.id);
        await rest.patch(updateRoute, { body: commandData });
      } else {
        await rest.post(commandRoute, { body: commandData });
      }
    }

    console.info(
      `Connected as ${readyClient.user.tag}; /ping and /ticket are registered ${
        guildId ? "for the development server" : "globally"
      }.`,
    );
  } catch (error) {
    console.error("Could not register Discord slash commands:", error);
    await client.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        await interaction.reply("Pong!");
        return;
      }
      if (interaction.commandName === "ticket") {
        await handleTicketCommand(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      await handleTicketButton(interaction);
    }
  } catch (error) {
    console.error("Could not process Discord interaction:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong while handling that interaction.",
        ephemeral: true,
      });
    }
  }
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