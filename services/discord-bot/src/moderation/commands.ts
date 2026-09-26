import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const moderationCommands = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to ban.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the ban.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remove a ban from a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((option) =>
      option.setName("user_id").setDescription("User ID to unban.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the unban.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to kick.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the kick.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to timeout.").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("Timeout duration in minutes.")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the timeout.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a member timeout.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to untimeout.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the change.").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and save the warning.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to warn.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Warning reason.").setMaxLength(500).setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("Remove a warning by ID.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member whose warning is removed.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("warning_id").setDescription("Warning ID.").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Show warnings for a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to inspect.").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete recent messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Number of messages, 1–100.").setMinValue(1).setMaxValue(100).setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((option) =>
      option.setName("seconds").setDescription("Seconds, 0–21600.").setMinValue(0).setMaxValue(21600).setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current channel for @everyone.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current channel for @everyone.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder()
    .setName("nick")
    .setDescription("Set or clear a member nickname.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to rename.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("nickname").setDescription("New nickname; use none to clear.").setMaxLength(32).setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Add or remove a role from a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Role action.")
        .addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" })
        .setRequired(true),
    )
    .addUserOption((option) =>
      option.setName("user").setDescription("Member.").setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role.").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Ban and immediately unban a member to remove recent messages.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to softban.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the softban.").setMaxLength(500),
    ),
];

export const moderationCommandNames = new Set(
  moderationCommands.map((command) => command.name),
);