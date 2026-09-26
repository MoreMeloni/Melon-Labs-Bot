import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const permissionGroups = [
  { name: "Moderation", value: "moderation" },
  { name: "Tickets", value: "tickets" },
  { name: "Giveaways", value: "giveaways" },
  { name: "Applications", value: "applications" },
  { name: "Logging", value: "logging" },
  { name: "Economy", value: "economy" },
  { name: "AI", value: "ai" },
  { name: "Music", value: "music" },
  { name: "Voice", value: "voice" },
  { name: "Configuration", value: "configuration" },
];

export const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure this server for the bot.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand.setName("status").setDescription("Show the server setup status."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("wizard")
      .setDescription("Configure the main bot channels and roles.")
      .addChannelOption((option) =>
        option
          .setName("log_channel")
          .setDescription("General log channel.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName("welcome_channel")
          .setDescription("Welcome channel.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName("leave_channel")
          .setDescription("Leave channel.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName("ai_channel")
          .setDescription("Optional AI channel.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      )
      .addRoleOption((option) =>
        option
          .setName("staff_role")
          .setDescription("Staff role.")
          .setRequired(false),
      )
      .addRoleOption((option) =>
        option
          .setName("moderator_role")
          .setDescription("Moderator role.")
          .setRequired(false),
      )
      .addRoleOption((option) =>
        option
          .setName("admin_role")
          .setDescription("Admin role.")
          .setRequired(false),
      )
      .addRoleOption((option) =>
        option
          .setName("auto_role")
          .setDescription("Role automatically assigned to new members.")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("reset")
      .setDescription("Reset bot configuration for this server."),
  );

export const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription("View or reset the bot configuration.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand.setName("view").setDescription("View configured channels and roles."),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("reset").setDescription("Reset the bot configuration."),
  );

export const permissionsCommand = new SlashCommandBuilder()
  .setName("permissions")
  .setDescription("Manage role-based bot permissions.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Allow a role to use a command group.")
      .addStringOption((option) =>
        option
          .setName("group")
          .setDescription("Command group.")
          .addChoices(...permissionGroups)
          .setRequired(true),
      )
      .addRoleOption((option) =>
        option.setName("role").setDescription("Allowed role.").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("reset")
      .setDescription("Remove custom roles from a command group.")
      .addStringOption((option) =>
        option
          .setName("group")
          .setDescription("Command group.")
          .addChoices(...permissionGroups)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("view").setDescription("View command group permissions."),
  );

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show available bot commands.")
  .addStringOption((option) =>
    option.setName("category").setDescription("Optional category to show."),
  );

export const botInfoCommand = new SlashCommandBuilder()
  .setName("botinfo")
  .setDescription("Show information about the bot.");

export const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Show server and bot statistics.");

export const uptimeCommand = new SlashCommandBuilder()
  .setName("uptime")
  .setDescription("Show how long the bot has been online.");

export const inviteCommand = new SlashCommandBuilder()
  .setName("invite")
  .setDescription("Get an invite link for this bot.");

export const languageCommand = new SlashCommandBuilder()
  .setName("language")
  .setDescription("View or change the server language.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) =>
    option
      .setName("language")
      .setDescription("Language for bot messages.")
      .addChoices(
        { name: "English", value: "en" },
        { name: "Deutsch", value: "de" },
      ),
  );

export const utilityCommands = [
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show a member's public server profile.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to view."),
    ),
  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a member's avatar.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to view."),
    ),
  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Show information about this server."),
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show public information about a member.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to view."),
    ),
  new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription("Show information about a role.")
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to inspect.").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("channelinfo")
    .setDescription("Show information about a channel.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to inspect.")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("emojiinfo")
    .setDescription("Show information about a custom emoji.")
    .addStringOption((option) =>
      option.setName("emoji").setDescription("Emoji ID or emoji markup.").setRequired(true),
    ),
];

export const coreCommands = [
  setupCommand,
  configCommand,
  permissionsCommand,
  helpCommand,
  botInfoCommand,
  statsCommand,
  uptimeCommand,
  inviteCommand,
  languageCommand,
  ...utilityCommands,
];