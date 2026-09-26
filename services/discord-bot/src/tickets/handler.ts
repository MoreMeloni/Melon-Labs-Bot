import {
  ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import {
  handleTicketButton as handleLifecycleButton,
  handleTicketLifecycleCommand,
  handleTicketModal as handleLifecycleModal,
  handleTicketUserSelect as handleLifecycleUserSelect,
} from "./lifecycle.js";
import { handleTicketSettings } from "./settings.js";

const settingSubcommands = new Set([
  "setup",
  "panel",
  "config",
  "config-panel",
  "config-limits",
  "config-messages",
  "config-button",
  "config-staff-add",
  "config-staff-remove",
  "config-transcript",
  "type-add",
  "type-edit",
  "type-remove",
  "type-list",
]);

async function sendCommandError(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const message =
    "The ticket command failed. Check the ticket settings and the bot's channel permissions.";
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message, components: [] });
  } else {
    await interaction.reply({ content: message, ephemeral: true });
  }
}

export async function handleTicketCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Tickets can only be managed in a server.",
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand();
    if (settingSubcommands.has(subcommand)) {
      await handleTicketSettings(interaction, interaction.guild, subcommand);
    } else {
      await handleTicketLifecycleCommand(interaction, subcommand);
    }
  } catch (error) {
    console.error("Ticket command failed:", error);
    await sendCommandError(interaction);
  }
}

export async function handleTicketButton(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await handleLifecycleButton(interaction);
  } catch (error) {
    console.error("Ticket button failed:", error);
    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({
          content: "The ticket action failed. Check the bot's permissions and try again.",
        })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({
          content: "The ticket action failed. Check the bot's permissions and try again.",
          ephemeral: true,
        })
        .catch(() => undefined);
    }
  }
}

export async function handleTicketModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await handleLifecycleModal(interaction);
  } catch (error) {
    console.error("Ticket modal failed:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: "The ticket action failed. Check the bot's permissions and try again.",
          ephemeral: true,
        })
        .catch(() => undefined);
    }
  }
}

export async function handleTicketUserSelect(
  interaction: UserSelectMenuInteraction,
): Promise<void> {
  try {
    await handleLifecycleUserSelect(interaction);
  } catch (error) {
    console.error("Ticket member picker failed:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: "The ticket member update failed. Check permissions and try again.",
          ephemeral: true,
        })
        .catch(() => undefined);
    }
  }
}