import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  SlashCommandBuilder,
} from "discord.js";

export const CREATE_TICKET_BUTTON_ID = "tickets:create";
export const CLOSE_TICKET_BUTTON_ID = "tickets:close";

export const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Configure and manage private support tickets.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
      .setDescription("Set the ticket category, support role, and log channel.")
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("Category where private tickets will be created.")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true),
      )
      .addRoleOption((option) =>
        option
          .setName("support_role")
          .setDescription("Role that can see and manage tickets.")
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("log_channel")
          .setDescription("Text channel for ticket creation and closure logs.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("panel")
      .setDescription("Post a button panel for opening tickets.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post the panel; defaults to this channel.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("close")
      .setDescription("Close the current ticket.")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Optional reason recorded in the ticket log.")
          .setMaxLength(500)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Give a member access to the current ticket.")
      .addUserOption((option) =>
        option
          .setName("member")
          .setDescription("Member to add.")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a member's access to the current ticket.")
      .addUserOption((option) =>
        option
          .setName("member")
          .setDescription("Member to remove.")
          .setRequired(true),
      ),
  );

export function createTicketPanelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CREATE_TICKET_BUTTON_ID)
      .setLabel("Create a ticket")
      .setStyle(ButtonStyle.Primary),
  );
}

export function createTicketCloseRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_TICKET_BUTTON_ID)
      .setLabel("Close ticket")
      .setStyle(ButtonStyle.Danger),
  );
}