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
  handleTicketModal,
  handleTicketUserSelect,
} from "./tickets/handler.js";
import { ticketCommand } from "./tickets/commands.js";
import { restoreTicketDeletionTimers } from "./tickets/lifecycle.js";
import { coreCommands } from "./core/commands.js";
import { handleCoreCommand } from "./core/handler.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("Missing DISCORD_TOKEN. Add the bot token to Replit Secrets.");
}
const verifiedToken: string = token;

const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the bot is online.");

const applicationCommands = [pingCommand, ...coreCommands, ticketCommand];

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.on(Events.Debug, (message) => {
  if (
    message.includes("Connecting") ||
    message.includes("Identifying") ||
    message.includes("Ready")
  ) {
    console.info(`Discord gateway: ${message}`);
  }
});
client.on(Events.Warn, (message) => {
  console.warn(`Discord warning: ${message}`);
});
client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function synchronizeApplicationCommands(
  readyClient: Client<true>,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(verifiedToken);
  const guildId = process.env.DISCORD_GUILD_ID;
  const commandRoute = guildId
    ? Routes.applicationGuildCommands(readyClient.user.id, guildId)
    : Routes.applicationCommands(readyClient.user.id);

  try {
    const existingCommands = (await withTimeout(
      rest.get(commandRoute),
      "Discord command lookup",
    )) as {
      id: string;
      name: string;
      type: number;
    }[];

    let failedCommands = 0;
    for (const command of applicationCommands) {
      const commandData = command.toJSON();
      const existingCommand = existingCommands.find(
        (registered) =>
          registered.name === commandData.name &&
          registered.type === ApplicationCommandType.ChatInput,
      );

      try {
        if (existingCommand) {
          console.info(`Updating /${commandData.name}...`);
          const updateRoute = guildId
            ? Routes.applicationGuildCommand(
                readyClient.user.id,
                guildId,
                existingCommand.id,
              )
            : Routes.applicationCommand(readyClient.user.id, existingCommand.id);
          await withTimeout(
            rest.patch(updateRoute, { body: commandData }),
            `Updating /${commandData.name}`,
          );
        } else {
          console.info(`Registering /${commandData.name}...`);
          await withTimeout(
            rest.post(commandRoute, { body: commandData }),
            `Registering /${commandData.name}`,
          );
        }
        console.info(`Synchronized /${commandData.name}.`);
      } catch (error) {
        failedCommands += 1;
        console.error(`Could not synchronize /${commandData.name}:`, error);
      }
    }

    console.info(
      `Managed command sync finished with ${failedCommands} failure(s) ${
        guildId ? "for the development server" : "globally"
      }.`,
    );
  } catch (error) {
    console.error(
      "Could not read existing Discord slash commands; the bot remains online and will retry on the next restart:",
      error,
    );
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.info(
    `Connected to Discord as ${readyClient.user.tag}; bot is online. Synchronizing ${applicationCommands.length} managed commands in the background...`,
  );
  void synchronizeApplicationCommands(readyClient);
  void restoreTicketDeletionTimers(readyClient).catch((error) => {
    console.error("Could not restore ticket deletion timers:", error);
  });
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
        return;
      }
      if (coreCommands.some((command) => command.name === interaction.commandName)) {
        await handleCoreCommand(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      await handleTicketButton(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleTicketModal(interaction);
      return;
    }
    if (interaction.isUserSelectMenu()) {
      await handleTicketUserSelect(interaction);
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

async function startDiscordClient(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await withTimeout(
        client.login(verifiedToken),
        `Discord login attempt ${attempt}`,
        30_000,
      );
      if (!client.isReady()) {
        await withTimeout(
          new Promise<void>((resolve) => {
            client.once(Events.ClientReady, () => resolve());
          }),
          `Discord READY attempt ${attempt}`,
          15_000,
        );
      }
      return;
    } catch (error) {
      console.error(`Discord connection attempt ${attempt} failed:`, error);
      client.destroy();
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    }
  }

  console.error(
    "Discord could not complete the gateway handshake after three attempts.",
  );
  process.exitCode = 1;
}

void startDiscordClient();

const shutdown = () => {
  client.destroy();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);