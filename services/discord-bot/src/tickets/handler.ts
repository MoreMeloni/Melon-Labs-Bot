import {
  ButtonInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
} from "discord.js";
import {
  CLOSE_TICKET_BUTTON_ID,
  CREATE_TICKET_BUTTON_ID,
  createTicketCloseRow,
  createTicketPanelRow,
} from "./commands.js";
import {
  getTicketConfig,
  saveTicketConfig,
  type TicketConfig,
} from "./store.js";

type TicketMetadata = {
  ownerId: string;
  status: "open" | "closed";
  createdAt: string;
};

type TicketInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction;

function makeTicketTopic(metadata: TicketMetadata): string {
  return `ticket-owner=${metadata.ownerId};ticket-status=${metadata.status};ticket-created=${metadata.createdAt}`;
}

function readTicketMetadata(topic: string | null): TicketMetadata | undefined {
  const match = topic?.match(
    /^ticket-owner=(\d+);ticket-status=(open|closed);ticket-created=(\d+)$/,
  );
  if (!match) return undefined;

  return {
    ownerId: match[1],
    status: match[2] as TicketMetadata["status"],
    createdAt: match[3],
  };
}

function isLogChannel(
  channel: GuildBasedChannel | null,
): channel is GuildBasedChannel & { send: TextChannel["send"] } {
  return (
    channel?.type === ChannelType.GuildText ||
    channel?.type === ChannelType.GuildAnnouncement
  );
}

function canManageSetup(interaction: TicketInteraction): boolean {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ??
    false
  );
}

function hasRole(interaction: TicketInteraction, roleId: string): boolean {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  return Array.isArray(roles) ? roles.includes(roleId) : roles.cache.has(roleId);
}

function canManageTicket(
  interaction: TicketInteraction,
  ownerId: string,
  supportRoleId: string,
): boolean {
  return (
    interaction.user.id === ownerId ||
    hasRole(interaction, supportRoleId) ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ??
      false)
  );
}

async function sendReply(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

async function sendTicketLog(
  guild: Guild,
  config: TicketConfig,
  embed: EmbedBuilder,
): Promise<void> {
  const channel = await guild.channels.fetch(config.logChannelId);
  if (!isLogChannel(channel)) {
    throw new Error("The configured ticket log channel is missing or invalid.");
  }

  const botMember = guild.members.me;
  const permissions = botMember && channel.permissionsFor(botMember);
  if (
    !permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    throw new Error(
      "The bot needs view, send-message, and embed permissions in the ticket log channel.",
    );
  }

  await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

function makeTicketLogEmbed(
  title: string,
  channel: TextChannel,
  userId: string,
  action: string,
  reason?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(title === "Ticket opened" ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      { name: "Ticket", value: `<#${channel.id}>`, inline: true },
      { name: action, value: `<@${userId}>`, inline: true },
    )
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: "Reason", value: reason.slice(0, 1000) });
  }

  return embed;
}

async function findOpenTicket(
  guild: Guild,
  ownerId: string,
): Promise<TextChannel | undefined> {
  const channels = await guild.channels.fetch();
  for (const channel of channels?.values() ?? []) {
    if (!channel || channel.type !== ChannelType.GuildText) continue;
    const metadata = readTicketMetadata(channel.topic);
    if (
      metadata?.ownerId !== ownerId ||
      metadata.status !== "open"
    ) {
      continue;
    }
    return channel;
  }
  return undefined;
}

async function validateStoredConfig(
  guild: Guild,
  config: TicketConfig,
): Promise<{ categoryId: string; supportRoleId: string } | undefined> {
  const [category, supportRole, logChannel] = await Promise.all([
    guild.channels.fetch(config.categoryId),
    guild.roles.fetch(config.supportRoleId),
    guild.channels.fetch(config.logChannelId),
  ]);

  if (
    category?.type !== ChannelType.GuildCategory ||
    !supportRole ||
    supportRole.id === guild.id ||
    !isLogChannel(logChannel)
  ) {
    return undefined;
  }

  return {
    categoryId: category.id,
    supportRoleId: supportRole.id,
  };
}

async function setupTicketSystem(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  if (!canManageSetup(interaction)) {
    await sendReply(interaction, "Only server managers can configure tickets.");
    return;
  }

  const categoryOption = interaction.options.getChannel("category", true);
  const supportRoleOption = interaction.options.getRole("support_role", true);
  const logChannelOption = interaction.options.getChannel("log_channel", true);
  const [category, supportRole, logChannel] = await Promise.all([
    guild.channels.fetch(categoryOption.id),
    guild.roles.fetch(supportRoleOption.id),
    guild.channels.fetch(logChannelOption.id),
  ]);

  if (
    category?.type !== ChannelType.GuildCategory ||
    !supportRole ||
    !isLogChannel(logChannel) ||
    supportRole.id === guild.id
  ) {
    await sendReply(
      interaction,
      "Choose a category, a support role other than @everyone, and a text log channel.",
    );
    return;
  }

  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await sendReply(
      interaction,
      "The bot needs the Manage Channels permission to create and close tickets.",
    );
    return;
  }

  const logPermissions = logChannel.permissionsFor(botMember);
  if (
    !logPermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    await sendReply(
      interaction,
      "The bot needs view, send-message, and embed permissions in the log channel.",
    );
    return;
  }

  await saveTicketConfig(guild.id, {
    categoryId: category.id,
    supportRoleId: supportRole.id,
    logChannelId: logChannel.id,
  });

  await sendReply(
    interaction,
    `Ticket system configured: category <#${category.id}>, support role <@&${supportRole.id}>, logs <#${logChannel.id}>.`,
  );
}

async function postTicketPanel(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  if (!canManageSetup(interaction)) {
    await sendReply(interaction, "Only server managers can post a ticket panel.");
    return;
  }

  const config = await getTicketConfig(guild.id);
  if (!config) {
    await sendReply(interaction, "Run `/ticket setup` before posting a panel.");
    return;
  }

  const requestedChannel = interaction.options.getChannel("channel");
  const panelChannelId = requestedChannel?.id ?? interaction.channelId;
  const panelChannel = panelChannelId
    ? await guild.channels.fetch(panelChannelId)
    : null;
  if (!isLogChannel(panelChannel)) {
    await sendReply(interaction, "Choose a text channel for the ticket panel.");
    return;
  }

  const botMember = guild.members.me;
  const permissions = botMember && panelChannel.permissionsFor(botMember);
  if (
    !permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    await sendReply(
      interaction,
      "The bot needs view, send-message, and embed permissions in the panel channel.",
    );
    return;
  }

  await panelChannel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Need help?")
        .setDescription(
          "Select the button below to open a private support ticket. Only you and the support team will be able to see it.",
        )
        .setColor(0x5865f2),
    ],
    components: [createTicketPanelRow()],
  });

  await sendReply(interaction, `Ticket panel posted in <#${panelChannel.id}>.`);
}

async function createTicket(
  interaction: ButtonInteraction,
  guild: Guild,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const config = await getTicketConfig(guild.id);
  if (!config) {
    await sendReply(interaction, "Ticket setup is missing. Ask a server manager to run `/ticket setup`.");
    return;
  }

  const storedConfig = await validateStoredConfig(guild, config);
  if (!storedConfig) {
    await sendReply(
      interaction,
      "Ticket setup references a deleted or invalid Discord resource. Ask a server manager to run `/ticket setup` again.",
    );
    return;
  }

  const existing = await findOpenTicket(guild, interaction.user.id);
  if (existing) {
    await sendReply(interaction, `You already have an open ticket: <#${existing.id}>.`);
    return;
  }

  const slug =
    interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .slice(0, 70) || "member";
  const createdAt = Date.now().toString();
  const topic = makeTicketTopic({
    ownerId: interaction.user.id,
    status: "open",
    createdAt,
  });

  let ticketChannel: TextChannel | undefined;
  try {
    ticketChannel = await guild.channels.create({
      name: `ticket-${slug}`,
      type: ChannelType.GuildText,
      parent: storedConfig.categoryId,
      topic,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        {
          id: storedConfig.supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ],
    });

    await ticketChannel.send({
      content: `Welcome <@${interaction.user.id}>. The support team can help you here.`,
      embeds: [
        new EmbedBuilder()
          .setTitle("Support ticket")
          .setDescription(
            "Describe your issue below. A support team member will respond in this private channel.",
          )
          .setColor(0x5865f2),
      ],
      components: [createTicketCloseRow()],
      allowedMentions: {
        users: [interaction.user.id],
        parse: [],
      },
    });
  } catch (error) {
    console.error("Could not create or initialize a ticket channel:", error);
    await ticketChannel?.delete("Ticket setup failed").catch(() => undefined);
    await sendReply(
      interaction,
      "I couldn't create the ticket. Check that the bot can manage channels in the configured category.",
    );
    return;
  }

  if (!ticketChannel) {
    await sendReply(interaction, "I couldn't create the ticket channel.");
    return;
  }

  let logWarning = "";
  try {
    await sendTicketLog(
      guild,
      config,
      makeTicketLogEmbed(
        "Ticket opened",
        ticketChannel,
        interaction.user.id,
        "Opened by",
      ),
    );
  } catch (error) {
    console.error("Ticket was created, but its opening log failed:", error);
    logWarning = " The ticket log could not be sent; ask an administrator to check the log channel.";
  }

  await sendReply(
    interaction,
    `Your private ticket is ready: <#${ticketChannel.id}>.${logWarning}`,
  );
}

async function closeTicket(
  channel: TextChannel,
  guild: Guild,
  config: TicketConfig,
  actorId: string,
  reason?: string,
): Promise<{ closed: boolean; logFailed: boolean }> {
  const metadata = readTicketMetadata(channel.topic);
  if (!metadata || metadata.status !== "open") {
    return { closed: false, logFailed: false };
  }

  await channel.permissionOverwrites.edit(metadata.ownerId, {
    SendMessages: false,
    AttachFiles: false,
  });
  await channel.setTopic(
    makeTicketTopic({ ...metadata, status: "closed" }),
  );
  if (!channel.name.startsWith("closed-")) {
    await channel.setName(`closed-${channel.name}`.slice(0, 100));
  }

  try {
    await sendTicketLog(
      guild,
      config,
      makeTicketLogEmbed(
        "Ticket closed",
        channel,
        actorId,
        "Closed by",
        reason || "No reason provided.",
      ),
    );
    return { closed: true, logFailed: false };
  } catch (error) {
    console.error("Ticket was closed, but its closing log failed:", error);
    return { closed: true, logFailed: true };
  }
}

async function closeTicketFromCommand(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const config = await getTicketConfig(guild.id);
  if (!config) {
    await sendReply(interaction, "Ticket setup is missing. Ask a server manager to run `/ticket setup`.");
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await sendReply(interaction, "Run `/ticket close` inside an open ticket channel.");
    return;
  }

  const metadata = readTicketMetadata(channel.topic);
  if (!metadata || metadata.status !== "open") {
    await sendReply(interaction, "This channel is not an open ticket.");
    return;
  }
  if (!canManageTicket(interaction, metadata.ownerId, config.supportRoleId)) {
    await sendReply(interaction, "Only the ticket owner or support team can close this ticket.");
    return;
  }

  const reason = interaction.options.getString("reason")?.trim();
  const result = await closeTicket(
    channel,
    guild,
    config,
    interaction.user.id,
    reason,
  );
  if (!result.closed) {
    await sendReply(interaction, "This ticket is already closed.");
    return;
  }

  await sendReply(
    interaction,
    `Ticket closed.${result.logFailed ? " The closing log could not be sent; ask an administrator to check the log channel." : ""}`,
  );
}

async function changeTicketMember(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  config: TicketConfig,
  action: "add" | "remove",
): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await sendReply(interaction, `Run \`/ticket ${action}\` inside an open ticket channel.`);
    return;
  }

  const metadata = readTicketMetadata(channel.topic);
  if (!metadata || metadata.status !== "open") {
    await sendReply(interaction, "This channel is not an open ticket.");
    return;
  }
  if (!canManageTicket(interaction, metadata.ownerId, config.supportRoleId)) {
    await sendReply(interaction, "Only the ticket owner or support team can change ticket access.");
    return;
  }

  const memberId = interaction.options.getUser("member", true).id;
  const member = interaction.options.getMember("member");
  if (!member) {
    await sendReply(interaction, "Choose a member of this server.");
    return;
  }
  const memberRoles = member.roles;
  const memberIsSupport = Array.isArray(memberRoles)
    ? memberRoles.includes(config.supportRoleId)
    : memberRoles.cache.has(config.supportRoleId);
  if (
    action === "remove" &&
    (memberId === metadata.ownerId || memberIsSupport)
  ) {
    await sendReply(interaction, "The ticket owner and support role cannot be removed.");
    return;
  }

  if (action === "add") {
    await channel.permissionOverwrites.edit(memberId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });
    await sendReply(interaction, `Added <@${memberId}> to this ticket.`);
  } else {
    await channel.permissionOverwrites.delete(memberId);
    await sendReply(interaction, `Removed <@${memberId}> from this ticket.`);
  }
}

export async function handleTicketCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await sendReply(interaction, "Tickets can only be managed in a server.");
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "setup") {
      await setupTicketSystem(interaction, interaction.guild);
      return;
    }
    if (subcommand === "panel") {
      await postTicketPanel(interaction, interaction.guild);
      return;
    }
    if (subcommand === "close") {
      await closeTicketFromCommand(interaction, interaction.guild);
      return;
    }

    const config = await getTicketConfig(interaction.guild.id);
    if (!config) {
      await sendReply(
        interaction,
        "Ticket setup is missing. Ask a server manager to run `/ticket setup`.",
      );
      return;
    }
    await changeTicketMember(
      interaction,
      interaction.guild,
      config,
      subcommand as "add" | "remove",
    );
  } catch (error) {
    console.error("Ticket command failed:", error);
    await sendReply(
      interaction,
      "The ticket command failed. Check the bot's channel permissions and configuration.",
    );
  }
}

export async function handleTicketButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await sendReply(interaction, "Tickets can only be used in a server.");
    return;
  }

  if (interaction.customId === CREATE_TICKET_BUTTON_ID) {
    try {
      await createTicket(interaction, interaction.guild);
    } catch (error) {
      console.error("Ticket creation interaction failed:", error);
      await sendReply(
        interaction,
        "I couldn't open the ticket. Ask a server manager to check the ticket setup and bot permissions.",
      );
    }
    return;
  }

  if (interaction.customId !== CLOSE_TICKET_BUTTON_ID) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const config = await getTicketConfig(interaction.guild.id);
    if (!config) {
      await sendReply(interaction, "Ticket setup is missing. Ask a server manager to run `/ticket setup`.");
      return;
    }

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await sendReply(interaction, "This button can only close a ticket channel.");
      return;
    }

    const metadata = readTicketMetadata(channel.topic);
    if (!metadata || metadata.status !== "open") {
      await sendReply(interaction, "This ticket is already closed.");
      return;
    }
    if (!canManageTicket(interaction, metadata.ownerId, config.supportRoleId)) {
      await sendReply(interaction, "Only the ticket owner or support team can close this ticket.");
      return;
    }

    const result = await closeTicket(
      channel,
      interaction.guild,
      config,
      interaction.user.id,
    );
    await sendReply(
      interaction,
      result.closed
        ? `Ticket closed.${result.logFailed ? " The closing log could not be sent; ask an administrator to check the log channel." : ""}`
        : "This ticket is already closed.",
    );
  } catch (error) {
    console.error("Ticket close interaction failed:", error);
    await sendReply(
      interaction,
      "I couldn't close the ticket. Check the bot's channel permissions and ticket setup.",
    );
  }
}