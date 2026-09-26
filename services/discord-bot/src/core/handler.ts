import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type Role,
} from "discord.js";
import {
  ensureGuildConfig,
  getGuildConfig,
  listGuildConfigs,
  resetGuildConfig,
  updateGuildConfig,
  type GuildConfig,
  type PermissionGroup,
} from "./store.js";

const startedAt = Date.now();

const labels: Record<PermissionGroup, string> = {
  moderation: "Moderation",
  tickets: "Tickets",
  giveaways: "Giveaways",
  applications: "Applications",
  logging: "Logging",
  economy: "Economy",
  ai: "AI",
  music: "Music",
  voice: "Voice",
  configuration: "Configuration",
};

function isManager(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

function colorNumber(color: string): number {
  const normalized = color.replace(/^#/, "");
  return /^[\da-fA-F]{6}$/.test(normalized)
    ? Number.parseInt(normalized, 16)
    : 0x5865f2;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [
    days > 0 ? `${days}d` : "",
    hours > 0 ? `${hours}h` : "",
    minutes > 0 ? `${minutes}m` : "",
    `${remainder}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

function channelMention(id?: string): string {
  return id ? `<#${id}>` : "Not configured";
}

function roleMentions(roleIds: string[]): string {
  return roleIds.length > 0 ? roleIds.map((id) => `<@&${id}>`).join(", ") : "None";
}

async function respond(
  interaction: ChatInputCommandInteraction,
  content?: string,
  embeds?: EmbedBuilder[],
): Promise<void> {
  const payload = {
    ...(content ? { content } : {}),
    ...(embeds ? { embeds } : {}),
    ephemeral: true,
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply(payload);
  }
}

function setupStatus(config: GuildConfig, guild: Guild): string {
  const channelChecks = [
    ["Log", config.channels.log],
    ["Welcome", config.channels.welcome],
    ["Leave", config.channels.leave],
    ["AI", config.channels.ai],
  ];
  const roleChecks = [
    ["Staff", config.roles.staff],
    ["Moderators", config.roles.moderators],
    ["Admins", config.roles.admins],
    ["Auto-role", config.roles.autoRole ? [config.roles.autoRole] : []],
  ];
  const channelLines = channelChecks.map(([name, id]) => {
    const exists = typeof id === "string" && guild.channels.cache.has(id);
    return `${exists ? "✅" : "⚪"} ${name}: ${id ? `<#${id}>` : "not configured"}`;
  });
  const roleLines = roleChecks.map(([name, ids]) => {
    const roleIds = Array.isArray(ids) ? ids : [];
    const exists = roleIds.length > 0 && roleIds.some((id) => guild.roles.cache.has(id));
    return `${exists ? "✅" : "⚪"} ${name}: ${roleMentions(roleIds)}`;
  });
  return [...channelLines, ...roleLines].join("\n");
}

async function handleSetup(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  if (!isManager(interaction)) {
    await respond(interaction, "Only server managers can change bot setup.");
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "reset") {
    await resetGuildConfig(guild.id);
    await respond(interaction, "The bot configuration for this server was reset.");
    return;
  }

  const current = await ensureGuildConfig(guild.id);
  if (subcommand === "status") {
    const embed = new EmbedBuilder()
      .setTitle(`Setup status — ${guild.name}`)
      .setColor(colorNumber(current.embedColor))
      .setDescription(setupStatus(current, guild))
      .setFooter({ text: current.footerText })
      .setTimestamp();
    await respond(interaction, undefined, [embed]);
    return;
  }

  const channelUpdates: GuildConfig["channels"] = {};
  const roleUpdates: GuildConfig["roles"] = {
    staff: current.roles.staff,
    moderators: current.roles.moderators,
    admins: current.roles.admins,
  };
  for (const key of ["log_channel", "welcome_channel", "leave_channel", "ai_channel"] as const) {
    const option = interaction.options.getChannel(key);
    if (option) {
      const target =
        key === "log_channel"
          ? "log"
          : key === "welcome_channel"
            ? "welcome"
            : key === "leave_channel"
              ? "leave"
              : "ai";
      channelUpdates[target] = option.id;
    }
  }
  const roleMappings = [
    ["staff_role", "staff"],
    ["moderator_role", "moderators"],
    ["admin_role", "admins"],
  ] as const;
  for (const [optionName, target] of roleMappings) {
    const role = interaction.options.getRole(optionName);
    if (role) roleUpdates[target] = [...new Set([...roleUpdates[target], role.id])];
  }
  const autoRole = interaction.options.getRole("auto_role");
  if (autoRole) roleUpdates.autoRole = autoRole.id;

  if (
    Object.keys(channelUpdates).length === 0 &&
    JSON.stringify(roleUpdates) === JSON.stringify(current.roles)
  ) {
    await respond(
      interaction,
      "Use `/setup wizard` with at least one channel or role, or use `/setup status` to inspect the current configuration.",
    );
    return;
  }
  await updateGuildConfig(guild.id, {
    channels: channelUpdates,
    roles: roleUpdates,
  });
  await respond(
    interaction,
    "Setup saved. Existing settings were preserved; run `/setup status` to review the result.",
  );
}

async function handleConfig(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  if (!isManager(interaction)) {
    await respond(interaction, "Only server managers can change bot configuration.");
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "reset") {
    await resetGuildConfig(guild.id);
    await respond(interaction, "The bot configuration for this server was reset.");
    return;
  }
  const config = await ensureGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setTitle(`Bot configuration — ${guild.name}`)
    .setColor(colorNumber(config.embedColor))
    .addFields(
      {
        name: "Language",
        value: config.language === "de" ? "Deutsch" : "English",
        inline: true,
      },
      { name: "Bot name", value: config.botName, inline: true },
      {
        name: "Channels",
        value: [
          `Logs: ${channelMention(config.channels.log)}`,
          `Welcome: ${channelMention(config.channels.welcome)}`,
          `Leave: ${channelMention(config.channels.leave)}`,
          `AI: ${channelMention(config.channels.ai)}`,
        ].join("\n"),
      },
      {
        name: "Roles",
        value: [
          `Staff: ${roleMentions(config.roles.staff)}`,
          `Moderators: ${roleMentions(config.roles.moderators)}`,
          `Admins: ${roleMentions(config.roles.admins)}`,
          `Auto-role: ${config.roles.autoRole ? `<@&${config.roles.autoRole}>` : "None"}`,
        ].join("\n"),
      },
    )
    .setFooter({ text: config.footerText })
    .setTimestamp();
  await respond(interaction, undefined, [embed]);
}

async function handlePermissions(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  if (!isManager(interaction)) {
    await respond(interaction, "Only server managers can change command permissions.");
    return;
  }
  const config = await ensureGuildConfig(guild.id);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "set") {
    const group = interaction.options.getString("group", true) as PermissionGroup;
    const role = interaction.options.getRole("role", true);
    const existing = config.commandRoles[group] ?? [];
    await updateGuildConfig(guild.id, {
      commandRoles: {
        [group]: [...new Set([...existing, role.id])],
      },
    });
    await respond(interaction, `Role <@&${role.id}> can now use the ${labels[group]} command group.`);
    return;
  }
  if (subcommand === "reset") {
    const group = interaction.options.getString("group", true) as PermissionGroup;
    const next = { ...config.commandRoles };
    delete next[group];
    await updateGuildConfig(guild.id, { commandRoles: next });
    await respond(interaction, `Custom permissions for ${labels[group]} were reset.`);
    return;
  }
  const lines = Object.entries(labels).map(([group, label]) => {
    const roles = config.commandRoles[group as PermissionGroup] ?? [];
    return `**${label}:** ${roleMentions(roles)}`;
  });
  await respond(interaction, lines.join("\n"));
}

async function handleHelp(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const config = await ensureGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setTitle(`${config.botName} help`)
    .setColor(colorNumber(config.embedColor))
    .setDescription(
      [
        "**Administration** — `/setup`, `/config`, `/permissions`, `/language`",
        "**Tickets** — `/ticket setup`, `/ticket panel`, `/ticket create`, `/ticket close`",
        "**Information** — `/botinfo`, `/stats`, `/uptime`, `/invite`",
        "**Utility** — `/profile`, `/avatar`, `/userinfo`, `/serverinfo`, `/roleinfo`, `/channelinfo`, `/emojiinfo`",
      ].join("\n"),
    )
    .setFooter({ text: config.footerText })
    .setTimestamp();
  await respond(interaction, undefined, [embed]);
}

async function handleUtility(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  commandName: string,
): Promise<void> {
  const config = await ensureGuildConfig(guild.id);
  const user = interaction.options.getUser("user") ?? interaction.user;
  if (commandName === "avatar") {
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s avatar`)
      .setColor(colorNumber(config.embedColor))
      .setImage(user.displayAvatarURL({ size: 1024 }))
      .setFooter({ text: config.footerText });
    await respond(interaction, undefined, [embed]);
    return;
  }
  if (commandName === "profile" || commandName === "userinfo") {
    const member = await guild.members.fetch(user.id).catch(() => null);
    const roles = member?.roles.cache
      .filter((role: Role) => role.id !== guild.id)
      .map((role: Role) => `<@&${role.id}>`)
      .join(", ");
    const embed = new EmbedBuilder()
      .setTitle(commandName === "profile" ? `${user.username}'s profile` : user.tag)
      .setThumbnail(user.displayAvatarURL())
      .setColor(colorNumber(config.embedColor))
      .addFields(
        { name: "User ID", value: user.id, inline: true },
        {
          name: "Joined server",
          value: member?.joinedAt?.toISOString() ?? "Unknown",
          inline: true,
        },
        { name: "Roles", value: roles || "None" },
      )
      .setFooter({ text: config.footerText });
    await respond(interaction, undefined, [embed]);
    return;
  }
  if (commandName === "serverinfo") {
    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setColor(colorNumber(config.embedColor))
      .setThumbnail(guild.iconURL() ?? "")
      .addFields(
        { name: "Server ID", value: guild.id, inline: true },
        { name: "Members", value: String(guild.memberCount), inline: true },
        { name: "Channels", value: String(guild.channels.cache.size), inline: true },
        { name: "Created", value: guild.createdAt.toISOString() },
      )
      .setFooter({ text: config.footerText });
    await respond(interaction, undefined, [embed]);
    return;
  }
  if (commandName === "roleinfo") {
    const roleOption = interaction.options.getRole("role", true);
    const role = guild.roles.cache.get(roleOption.id);
    if (!role) {
      await respond(interaction, "That role is no longer available in this server.");
      return;
    }
    await respond(
      interaction,
      `**${role.name}**\nID: \`${role.id}\`\nMembers: ${role.members.size}\nPosition: ${role.position}\nColor: ${role.hexColor}`,
    );
    return;
  }
  if (commandName === "channelinfo") {
    const channelOption = interaction.options.getChannel("channel");
    const channel = channelOption
      ? guild.channels.cache.get(channelOption.id)
      : interaction.channel;
    if (!channel) {
      await respond(interaction, "This interaction has no channel context.");
      return;
    }
    if (!("name" in channel) || !("createdAt" in channel)) {
      await respond(interaction, "That channel does not expose server channel information.");
      return;
    }
    const createdAt = channel.createdAt;
    await respond(
      interaction,
      `**${channel.name}**\nID: \`${channel.id}\`\nType: ${ChannelType[channel.type] ?? channel.type}\nCreated: ${createdAt ? createdAt.toISOString() : "Unknown"}`,
    );
    return;
  }
  const raw = interaction.options.getString("emoji", true);
  const id = raw.match(/(\d{15,})/)?.[1] ?? raw;
  const emoji = guild.emojis.cache.get(id);
  await respond(
    interaction,
    emoji
      ? `**${emoji.name ?? "emoji"}**\nID: \`${emoji.id}\`\nAnimated: ${emoji.animated}\nURL: ${emoji.url}`
      : "That custom emoji is not available in this server.",
  );
}

export async function handleCoreCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await respond(interaction, "This command can only be used in a server.");
    return;
  }
  const guild = interaction.guild;
  const name = interaction.commandName;
  if (name === "setup") return handleSetup(interaction, guild);
  if (name === "config") return handleConfig(interaction, guild);
  if (name === "permissions") return handlePermissions(interaction, guild);
  if (name === "help" || name === "commands") return handleHelp(interaction, guild);
  if (
    ["profile", "avatar", "serverinfo", "userinfo", "roleinfo", "channelinfo", "emojiinfo"].includes(
      name,
    )
  ) {
    return handleUtility(interaction, guild, name);
  }

  const config = await ensureGuildConfig(guild.id);
  if (name === "language") {
    if (!isManager(interaction)) {
      await respond(interaction, "Only server managers can change the language.");
      return;
    }
    const language = interaction.options.getString("language");
    if (!language) {
      await respond(interaction, `Current server language: ${config.language === "de" ? "Deutsch" : "English"}`);
      return;
    }
    await updateGuildConfig(guild.id, { language: language === "de" ? "de" : "en" });
    await respond(interaction, `Server language set to ${language === "de" ? "Deutsch" : "English"}.`);
    return;
  }
  if (name === "botinfo") {
    const embed = new EmbedBuilder()
      .setTitle(config.botName)
      .setColor(colorNumber(config.embedColor))
      .setDescription("A modular multi-server Discord bot.")
      .addFields(
        { name: "Servers", value: String(interaction.client.guilds.cache.size), inline: true },
        { name: "Uptime", value: formatDuration(Date.now() - startedAt), inline: true },
        { name: "Discord.js", value: "14.x", inline: true },
      )
      .setFooter({ text: config.footerText });
    await respond(interaction, undefined, [embed]);
    return;
  }
  if (name === "stats") {
    const totalMembers = interaction.client.guilds.cache.reduce(
      (sum, currentGuild) => sum + currentGuild.memberCount,
      0,
    );
    await respond(
      interaction,
      `**${guild.name}**\nMembers: ${guild.memberCount}\nChannels: ${guild.channels.cache.size}\nBot servers: ${interaction.client.guilds.cache.size}\nBot members visible: ${totalMembers}`,
    );
    return;
  }
  if (name === "uptime") {
    await respond(interaction, `Online for **${formatDuration(Date.now() - startedAt)}**.`);
    return;
  }
  if (name === "invite") {
    const clientId = interaction.client.user?.id;
    if (!clientId) {
      await respond(interaction, "The bot user is not ready yet.");
      return;
    }
    await respond(
      interaction,
      `Invite the bot with:\nhttps://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8`,
    );
  }
}

export function getBotStartedAt(): number {
  return startedAt;
}

export async function getConfiguredGuildCount(): Promise<number> {
  return (await listGuildConfigs()).length;
}