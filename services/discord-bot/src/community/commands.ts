import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const communityCommands = [
  new SlashCommandBuilder()
    .setName("faq")
    .setDescription("Manage and search this server's FAQ.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a FAQ question and answer.")
        .addStringOption((option) =>
          option.setName("question").setDescription("Question.").setMaxLength(200).setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("answer").setDescription("Answer.").setMaxLength(1500).setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a FAQ entry.")
        .addStringOption((option) =>
          option.setName("id").setDescription("FAQ entry ID.").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List FAQ entries."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("search")
        .setDescription("Search the FAQ.")
        .addStringOption((option) =>
          option.setName("query").setDescription("Search text.").setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("rules")
    .setDescription("View or configure server rules.")
    .addSubcommand((subcommand) =>
      subcommand.setName("view").setDescription("Show the current rules."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setup")
        .setDescription("Replace the server rules.")
        .addStringOption((option) =>
          option.setName("text").setDescription("Rules text.").setMaxLength(4000).setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Create a persistent reminder.")
    .addStringOption((option) =>
      option.setName("duration").setDescription("Examples: 30m, 2h, 1d.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("text").setDescription("Reminder text.").setMaxLength(500).setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a reaction poll.")
    .addStringOption((option) =>
      option.setName("question").setDescription("Poll question.").setMaxLength(300).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("option1").setDescription("First option.").setMaxLength(100).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("option2").setDescription("Second option.").setMaxLength(100).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("option3").setDescription("Optional third option.").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option4").setDescription("Optional fourth option.").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option5").setDescription("Optional fifth option.").setMaxLength(100),
    ),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a formatted announcement.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Target channel.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("title").setDescription("Announcement title.").setMaxLength(256).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("description").setDescription("Announcement body.").setMaxLength(4000).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("color").setDescription("Six-digit hex color.").setMaxLength(7),
    ),
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a server suggestion.")
    .addStringOption((option) =>
      option.setName("text").setDescription("Your suggestion.").setMaxLength(1500).setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report a member to server staff.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member being reported.").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Report reason.").setMaxLength(1000).setRequired(true),
    ),
];

export const communityCommandNames = new Set(
  communityCommands.map((command) => command.name),
);