import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextChannel,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
} from "discord.js";
import {
  ADD_TICKET_MEMBER_BUTTON_ID,
  CANCEL_ACTION_PREFIX,
  CLAIM_TICKET_BUTTON_ID,
  CLOSE_REASON_MODAL_ID,
  CLOSE_TICKET_BUTTON_ID,
  CONFIRM_ACTION_PREFIX,
  CREATE_TICKET_BUTTON_PREFIX,
  createCloseReasonModal,
  createConfirmActionRow,
  createTicketControlRows,
  DELETE_TICKET_BUTTON_ID,
  LOCK_TICKET_BUTTON_ID,
  LEGACY_CREATE_TICKET_BUTTON_ID,
  MEMBER_MODAL_PREFIX,
  REMOVE_TICKET_MEMBER_BUTTON_ID,
  REOPEN_TICKET_BUTTON_ID,
  TRANSCRIPT_TICKET_BUTTON_ID,
  UNCLAIM_TICKET_BUTTON_ID,
  UNLOCK_TICKET_BUTTON_ID,
} from "./commands.js";
import {
  parseTicketMetadata,
  renderTicketText,
  sanitizeChannelName,
  serializeTicketMetadata,
  type TicketMetadata,
} from "./metadata.js";
import {
  getTicketConfig,
  recordTicketOpened,
  type TicketConfig,
  type TicketTypeConfig,
} from "./store.js";
import { createAndSendTranscript } from "./transcript.js";

type TicketInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction
  | UserSelectMenuInteraction;

type PendingAction = {
  action: "close" | "delete";
  guildId: string;
  channelId: string;
  userId: string;
  reason: string;
  createdAt: number;
};

const pendingActions = new Map<string, PendingAction>();
const openLocks = new Set<string>();
const deleteTimers = new Map<string, NodeJS.Timeout>();

function isTicketTextChannel(channel: unknown): channel is TextChannel {
  return (
    typeof channel === "object" &&
    channel !== null &&
    "type" in channel &&
    channel.type === ChannelType.GuildText
  );
}

function isSendableLogChannel(
  channel: GuildBasedChannel | null,
): channel is GuildBasedChannel & Pick<TextChannel, "send"> {
  return (
    channel?.type === ChannelType.GuildText ||
    channel?.type === ChannelType.GuildAnnouncement
  );
}

function interactionRoleIds(interaction: TicketInteraction): string[] {
  const member = interaction.member;
  if (!member || !("roles" in member)) return [];
  if (Array.isArray(member.roles)) return member.roles;
  return member.roles.cache.map((role) => role.id);
}

function isServerAdmin(interaction: TicketInteraction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels),
  );
}

function supportRoleIds(
  config: TicketConfig,
  metadata: TicketMetadata,
): string[] {
  const ticketRoles =
    metadata.supportRoleIds.length > 0
      ? metadata.supportRoleIds
      : [config.supportRoleId];
  return [...new Set([...ticketRoles, ...config.staffRoleIds])];
}

function isTicketStaff(
  interaction: TicketInteraction,
  config: TicketConfig,
  metadata: TicketMetadata,
): boolean {
  if (isServerAdmin(interaction)) return true;
  const memberRoles = interactionRoleIds(interaction);
  return supportRoleIds(config, metadata).some((roleId) =>
    memberRoles.includes(roleId),
  );
}

function isGuildTicketStaff(
  interaction: TicketInteraction,
  config: TicketConfig,
): boolean {
  if (isServerAdmin(interaction)) return true;
  const memberRoles = interactionRoleIds(interaction);
  const configuredStaffRoles = [
    config.supportRoleId,
    ...config.staffRoleIds,
    ...config.ticketTypes.flatMap((ticketType) => ticketType.supportRoleIds),
  ];
  return configuredStaffRoles.some((roleId) => memberRoles.includes(roleId));
}

function canAccessTicketControls(
  interaction: TicketInteraction,
  config: TicketConfig,
  metadata: TicketMetadata,
): boolean {
  return (
    interaction.user.id === metadata.ownerId ||
    isTicketStaff(interaction, config, metadata)
  );
}

async function reply(
  interaction: TicketInteraction,
  content: string,
  components?: ActionRowBuilder<ButtonBuilder>[],
): Promise<void> {
  const options = {
    content,
    ...(components ? { components } : {}),
    allowedMentions: { parse: [] as const },
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(options);
  } else {
    await interaction.reply({ ...options, ephemeral: true });
  }
}

function colorNumber(color: string): number {
  const value = color.replace(/^#/, "");
  return /^[\da-fA-F]{6}$/.test(value)
    ? Number.parseInt(value, 16)
    : 0x5865f2;
}

function ticketLogEmbed(
  title: string,
  channel: TextChannel,
  metadata: TicketMetadata,
  actorId: string,
  details?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(title.includes("closed") || title.includes("deleted") ? 0xe74c3c : 0x5865f2)
    .setDescription(
      [
        `Ticket: <#${channel.id}>`,
        `Owner: <@${metadata.ownerId}>`,
        `Type: \`${metadata.typeId}\``,
        `Actor: <@${actorId}>`,
        details ? `Details: ${details.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .setTimestamp();
  return embed;
}

async function sendTicketLog(
  guild: Guild,
  config: TicketConfig,
  title: string,
  channel: TextChannel,
  metadata: TicketMetadata,
  actorId: string,
  details?: string,
): Promise<boolean> {
  try {
    const logChannel = await guild.channels.fetch(config.logChannelId);
    if (!isSendableLogChannel(logChannel)) return false;
    const botMember = guild.members.me;
    const permissions = botMember && logChannel.permissionsFor(botMember);
    if (
      !permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
    ) {
      return false;
    }
    await logChannel.send({
      embeds: [ticketLogEmbed(title, channel, metadata, actorId, details)],
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    console.error(`Could not send ticket log "${title}":`, error);
    return false;
  }
}

function findTicketType(
  config: TicketConfig,
  typeId?: string,
): TicketTypeConfig | undefined {
  return typeId
    ? config.ticketTypes.find((ticketType) => ticketType.id === typeId)
    : config.ticketTypes[0];
}

async function findOwnerTickets(
  guild: Guild,
  ownerId: string,
): Promise<{ channel: TextChannel; metadata: TicketMetadata }[]> {
  const channels = await guild.channels.fetch();
  const found: { channel: TextChannel; metadata: TicketMetadata }[] = [];
  for (const channel of channels?.values() ?? []) {
    if (!isTicketTextChannel(channel)) continue;
    const metadata = parseTicketMetadata(channel.topic);
    if (metadata?.ownerId === ownerId && metadata.status === "open") {
      found.push({ channel, metadata });
    }
  }
  return found;
}

function buildChannelName(
  config: TicketConfig,
  type: TicketTypeConfig,
  username: string,
  userId: string,
  number: number,
): string {
  const rendered = config.nameFormat
    .replaceAll("{username}", username)
    .replaceAll("{user}", username)
    .replaceAll("{userid}", userId)
    .replaceAll("{type}", type.id)
    .replaceAll("{number}", String(number));
  return sanitizeChannelName(rendered);
}

async function openTicket(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  guild: Guild,
  requestedTypeId?: string,
): Promise<void> {
  const lockKey = `${guild.id}:${interaction.user.id}`;
  if (openLocks.has(lockKey)) {
    await reply(interaction, "Your ticket request is already being processed.");
    return;
  }
  openLocks.add(lockKey);

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    const config = await getTicketConfig(guild.id);
    if (!config) {
      await reply(
        interaction,
        "Ticket setup is missing. Ask a server manager to run `/ticket setup`.",
      );
      return;
    }

    const ticketType = findTicketType(config, requestedTypeId);
    if (!ticketType) {
      await reply(
        interaction,
        `Ticket type \`${requestedTypeId}\` is not configured. Ask a server manager to refresh the panel or choose a listed type.`,
      );
      return;
    }

    const existingTickets = await findOwnerTickets(guild, interaction.user.id);
    const sameType = existingTickets.find(
      ({ metadata }) => metadata.typeId === ticketType.id,
    );
    if (sameType) {
      await reply(
        interaction,
        `You already have an open ${ticketType.label} ticket: <#${sameType.channel.id}>.`,
      );
      return;
    }
    if (existingTickets.length >= config.maxOpenTickets) {
      await reply(
        interaction,
        `You already have ${existingTickets.length} open ticket(s), which is the server limit of ${config.maxOpenTickets}.`,
      );
      return;
    }

    const lastOpened = config.lastOpenedAt[interaction.user.id] ?? 0;
    const waitSeconds =
      config.cooldownSeconds - Math.floor((Date.now() - lastOpened) / 1000);
    if (lastOpened > 0 && waitSeconds > 0) {
      await reply(
        interaction,
        `Please wait ${waitSeconds} second(s) before opening another ticket.`,
      );
      return;
    }

    const [category, botMember] = await Promise.all([
      guild.channels.fetch(ticketType.categoryId),
      Promise.resolve(guild.members.me),
    ]);
    if (category?.type !== ChannelType.GuildCategory) {
      await reply(
        interaction,
        "The category for this ticket type was deleted or is invalid. Ask a server manager to repair it with `/ticket setup` or `/ticket type-edit`.",
      );
      return;
    }
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await reply(
        interaction,
        "The bot needs Manage Channels to create ticket channels.",
      );
      return;
    }

    const configuredRoles = [
      ...new Set([
        ...ticketType.supportRoleIds,
        ...config.staffRoleIds,
        ...(ticketType.supportRoleIds.length === 0 ? [config.supportRoleId] : []),
      ]),
    ].filter((roleId) => roleId !== guild.id);
    const validRoleIds: string[] = [];
    for (const roleId of configuredRoles) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (role && role.id !== guild.id) validRoleIds.push(role.id);
    }
    if (validRoleIds.length === 0) {
      await reply(
        interaction,
        "No configured support roles are available. Ask a server manager to repair the ticket type's support role.",
      );
      return;
    }

    const openedAt = Date.now();
    const ticketNumber = Math.floor(openedAt / 1000) % 1000000;
    const metadata: TicketMetadata = {
      ownerId: interaction.user.id,
      status: "open",
      createdAt: openedAt,
      typeId: ticketType.id,
      supportRoleIds: validRoleIds,
    };
    const channelName = buildChannelName(
      config,
      ticketType,
      interaction.user.username,
      interaction.user.id,
      ticketNumber,
    );

    let ticketChannel: TextChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: serializeTicketMetadata(metadata),
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
          ...validRoleIds.map((roleId) => ({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          })),
          {
            id: interaction.client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
            ],
          },
        ],
      });
    } catch (error) {
      console.error("Could not create ticket channel:", error);
      await reply(
        interaction,
        "I couldn't create the ticket. Check the bot's Manage Channels permission and the configured category.",
      );
      return;
    }

    const welcomeTemplate =
      ticketType.welcomeMessage || config.welcomeMessage;
    const welcome = renderTicketText(welcomeTemplate, {
      userId: interaction.user.id,
      username: interaction.user.username,
      type: ticketType.label,
      number: ticketNumber,
    });
    const embed = new EmbedBuilder()
      .setTitle(`${ticketType.emoji} ${ticketType.label}`.slice(0, 256))
      .setDescription(
        "Describe what you need help with. A support team member will respond here.",
      )
      .setColor(colorNumber(ticketType.color ?? config.embedColor));
    if (config.footerText) embed.setFooter({ text: config.footerText });

    try {
      await ticketChannel.send({
        content: welcome.slice(0, 1800),
        embeds: [embed],
        components: createTicketControlRows("open"),
        allowedMentions: {
          users: [interaction.user.id],
          parse: [],
        },
      });
    } catch (error) {
      console.error("Could not initialize ticket channel:", error);
      await ticketChannel.delete("Ticket initialization failed").catch(() => null);
      await reply(
        interaction,
        "The ticket channel was created, but I couldn't send its welcome message or controls. Check the bot's send-message and embed permissions.",
      );
      return;
    }

    let warnings: string[] = [];
    try {
      await recordTicketOpened(guild.id, interaction.user.id, openedAt);
    } catch (error) {
      console.error("Ticket opened but cooldown could not be saved:", error);
      warnings.push("the cooldown timestamp could not be saved");
    }
    if (
      !(await sendTicketLog(
        guild,
        config,
        "Ticket created",
        ticketChannel,
        metadata,
        interaction.user.id,
        `Opened as ${ticketType.label}.`,
      ))
    ) {
      warnings.push("the ticket creation log could not be sent");
    }
    await reply(
      interaction,
      `Your private ${ticketType.label} ticket is ready: <#${ticketChannel.id}>.${warnings.length ? ` Note: ${warnings.join(" and ")}.` : ""}`,
    );
  } finally {
    openLocks.delete(lockKey);
  }
}

async function getCurrentTicket(
  interaction: TicketInteraction,
): Promise<
  | { channel: TextChannel; metadata: TicketMetadata; config: TicketConfig }
  | undefined
> {
  const guild = interaction.guild;
  const channel = interaction.channel;
  if (!guild || !isTicketTextChannel(channel)) {
    await reply(interaction, "Use this command inside a ticket channel.");
    return undefined;
  }
  const metadata = parseTicketMetadata(channel.topic);
  if (!metadata) {
    await reply(interaction, "This channel is not a ticket.");
    return undefined;
  }
  const config = await getTicketConfig(guild.id);
  if (!config) {
    await reply(interaction, "Ticket settings are missing. Ask a server manager to run `/ticket setup`.");
    return undefined;
  }
  return { channel, metadata, config };
}

async function refreshTicketControls(
  channel: TextChannel,
  metadata: TicketMetadata,
): Promise<void> {
  const displayName = metadata.claimedBy
    ? channel.guild.members.cache.get(metadata.claimedBy)?.displayName ?? "Staff"
    : undefined;
  const components = createTicketControlRows(metadata.status, displayName);
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const controlMessage = messages.find(
      (message) =>
        message.author.id === channel.client.user?.id &&
        message.components.some((row) =>
          "components" in row &&
          row.components.some(
            (component) =>
              "customId" in component &&
              String(component.customId).startsWith("tickets:"),
          ),
        ),
    );
    if (controlMessage) {
      await controlMessage.edit({ components });
    } else {
      await channel.send({ components });
    }
  } catch (error) {
    console.error("Could not refresh ticket controls:", error);
  }
}

function clearDeleteTimer(channelId: string): void {
  const timer = deleteTimers.get(channelId);
  if (timer) clearTimeout(timer);
  deleteTimers.delete(channelId);
}

function scheduleDelete(guild: Guild, channelId: string, deleteAt: number): void {
  clearDeleteTimer(channelId);
  const delay = Math.max(0, Math.min(2_147_000_000, deleteAt - Date.now()));
  const timer = setTimeout(() => {
    deleteTimers.delete(channelId);
    void automaticallyDeleteTicket(guild, channelId);
  }, delay);
  deleteTimers.set(channelId, timer);
}

async function closeTicket(
  guild: Guild,
  channel: TextChannel,
  config: TicketConfig,
  metadata: TicketMetadata,
  actorId: string,
  reason: string,
): Promise<{
  closed: boolean;
  transcriptSent: boolean;
  logSent: boolean;
  autoDeleteScheduled: boolean;
}> {
  if (metadata.status !== "open") {
    return {
      closed: false,
      transcriptSent: Boolean(metadata.transcriptPath),
      logSent: false,
      autoDeleteScheduled: false,
    };
  }

  await channel.permissionOverwrites.edit(metadata.ownerId, {
    SendMessages: false,
    AttachFiles: false,
  });
  const closedAt = Date.now();
  const closedMetadata: TicketMetadata = {
    ...metadata,
    status: "closed",
    closedAt,
    closedBy: actorId,
  };
  await channel.setTopic(serializeTicketMetadata(closedMetadata));
  if (!channel.name.startsWith("closed-")) {
    await channel.setName(`closed-${channel.name}`.slice(0, 100));
  }

  const type = config.ticketTypes.find((item) => item.id === metadata.typeId);
  const closingMessage = renderTicketText(config.closingMessage, {
    userId: metadata.ownerId,
    username: metadata.ownerId,
    type: type?.label ?? metadata.typeId,
    number: Math.floor(metadata.createdAt / 1000) % 1000000,
    closer: `<@${actorId}>`,
  });
  if (closingMessage.trim()) {
    await channel.send({
      content: closingMessage.slice(0, 1800),
      allowedMentions: { users: [metadata.ownerId, actorId], parse: [] },
    });
  }

  let transcriptSent = false;
  let transcriptPath: string | undefined;
  let deleteAt: number | undefined;
  let transcriptError: string | undefined;
  try {
    const transcript = await createAndSendTranscript(
      guild,
      channel,
      config,
      closedMetadata,
    );
    transcriptSent = transcript.sent;
    transcriptPath = transcript.path || undefined;
    transcriptError = transcript.error;
    if (transcript.sent && transcript.path) {
      if (config.deleteAfterSeconds > 0) {
        deleteAt = Date.now() + config.deleteAfterSeconds * 1000;
      }
      await sendTicketLog(
        guild,
        config,
        "Transcript created",
        channel,
        closedMetadata,
        actorId,
        `${transcript.messageCount} messages included; file: ${transcript.fileName}.`,
      );
    }
  } catch (error) {
    transcriptError = error instanceof Error ? error.message : String(error);
    console.error("Could not create ticket transcript:", error);
  }

  const finalMetadata: TicketMetadata = {
    ...closedMetadata,
    ...(transcriptPath ? { transcriptPath } : {}),
    ...(deleteAt ? { deleteAt } : {}),
  };
  await channel.setTopic(serializeTicketMetadata(finalMetadata));
  await refreshTicketControls(channel, finalMetadata);

  const closeLogSent = await sendTicketLog(
    guild,
    config,
    "Ticket closed",
    channel,
    finalMetadata,
    actorId,
    `Reason: ${reason || "No reason provided."}${transcriptError ? ` Transcript issue: ${transcriptError}` : ""}`,
  );
  if (deleteAt && transcriptSent) {
    scheduleDelete(guild, channel.id, deleteAt);
  }

  return {
    closed: true,
    transcriptSent,
    logSent: closeLogSent,
    autoDeleteScheduled: Boolean(deleteAt && transcriptSent),
  };
}

function createPendingAction(
  action: "close" | "delete",
  guildId: string,
  channelId: string,
  userId: string,
  reason: string,
): string {
  const now = Date.now();
  for (const [id, pending] of pendingActions.entries()) {
    if (now - pending.createdAt > 10 * 60 * 1000) {
      pendingActions.delete(id);
    }
  }
  const id = randomUUID().replaceAll("-", "").slice(0, 20);
  pendingActions.set(id, {
    action,
    guildId,
    channelId,
    userId,
    reason,
    createdAt: now,
  });
  return id;
}

async function requestConfirmation(
  interaction: TicketInteraction,
  action: "close" | "delete",
  reason = "",
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!canAccessTicketControls(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only the ticket owner or authorized staff can manage this ticket.");
    return;
  }
  if (action === "delete" && !isTicketStaff(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only ticket staff or administrators can delete tickets.");
    return;
  }
  if (action === "close" && ticket.metadata.status !== "open") {
    await reply(interaction, "This ticket is already closed.");
    return;
  }

  const requestId = createPendingAction(
    action,
    ticket.channel.guild.id,
    ticket.channel.id,
    interaction.user.id,
    reason,
  );
  const text =
    action === "close"
      ? "Close this ticket? A transcript will be created and sent to the configured transcript channel."
      : "Delete this ticket? A transcript will be saved and sent before the channel is deleted.";
  await reply(
    interaction,
    text,
    [createConfirmActionRow(action, requestId)],
  );
}

async function executeDelete(
  guild: Guild,
  channel: TextChannel,
  config: TicketConfig,
  metadata: TicketMetadata,
  actorId: string,
  reason: string,
): Promise<{ deleted: boolean; error?: string }> {
  const transcript = await createAndSendTranscript(guild, channel, config, metadata);
  if (!transcript.sent) {
    return {
      deleted: false,
      error:
        transcript.error ??
        "The transcript could not be sent, so the ticket was not deleted.",
    };
  }

  await sendTicketLog(
    guild,
    config,
    "Transcript created",
    channel,
    metadata,
    actorId,
    `${transcript.messageCount} messages included; file: ${transcript.fileName}.`,
  );
  const logged = await sendTicketLog(
    guild,
    config,
    "Ticket deleted",
    channel,
    metadata,
    actorId,
    `Reason: ${reason || "No reason provided."}`,
  );
  if (!logged) {
    return {
      deleted: false,
      error: "The transcript was sent, but the deletion log could not be sent. The ticket was kept.",
    };
  }

  clearDeleteTimer(channel.id);
  try {
    await channel.delete(`Ticket deleted by ${actorId}`);
    return { deleted: true };
  } catch (error) {
    return {
      deleted: false,
      error: `The ticket deletion failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function automaticallyDeleteTicket(
  guild: Guild,
  channelId: string,
): Promise<void> {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!isTicketTextChannel(channel)) return;
    const metadata = parseTicketMetadata(channel.topic);
    if (
      !metadata ||
      metadata.status !== "closed" ||
      !metadata.deleteAt ||
      !metadata.transcriptPath
    ) {
      return;
    }
    if (metadata.deleteAt > Date.now()) {
      scheduleDelete(guild, channelId, metadata.deleteAt);
      return;
    }
    const config = await getTicketConfig(guild.id);
    if (!config) return;
    const logged = await sendTicketLog(
      guild,
      config,
      "Ticket deleted",
      channel,
      metadata,
      guild.client.user?.id ?? guild.id,
      "Automatic deletion after the configured delay.",
    );
    if (!logged) {
      scheduleDelete(guild, channelId, Date.now() + 5 * 60 * 1000);
      return;
    }
    await channel.delete("Configured ticket retention period elapsed");
  } catch (error) {
    console.error("Automatic ticket deletion failed:", error);
    scheduleDelete(guild, channelId, Date.now() + 5 * 60 * 1000);
  }
}

export async function restoreTicketDeletionTimers(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const channels = await guild.channels.fetch();
      for (const channel of channels?.values() ?? []) {
        if (!isTicketTextChannel(channel)) continue;
        const metadata = parseTicketMetadata(channel.topic);
        if (
          metadata?.status === "closed" &&
          metadata.deleteAt &&
          metadata.transcriptPath
        ) {
          scheduleDelete(guild, channel.id, metadata.deleteAt);
        }
      }
    } catch (error) {
      console.error(`Could not restore ticket timers for guild ${guild.id}:`, error);
    }
  }
}

async function reopenTicket(
  interaction: TicketInteraction,
  reason = "",
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!isTicketStaff(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only ticket staff or administrators can reopen tickets.");
    return;
  }
  if (ticket.metadata.status !== "closed") {
    await reply(interaction, "This ticket is already open.");
    return;
  }

  await ticket.channel.permissionOverwrites.edit(ticket.metadata.ownerId, {
    SendMessages: true,
    AttachFiles: true,
  });
  const {
    closedAt: _closedAt,
    closedBy: _closedBy,
    deleteAt: _deleteAt,
    ...previous
  } = ticket.metadata;
  const metadata: TicketMetadata = {
    ...previous,
    status: "open",
    locked: false,
  };
  await ticket.channel.setTopic(serializeTicketMetadata(metadata));
  if (ticket.channel.name.startsWith("closed-")) {
    await ticket.channel.setName(ticket.channel.name.slice("closed-".length));
  }
  clearDeleteTimer(ticket.channel.id);
  await ticket.channel.send({
    content: `Ticket reopened by <@${interaction.user.id}>.${reason ? ` Reason: ${reason.slice(0, 500)}` : ""}`,
    allowedMentions: { users: [interaction.user.id], parse: [] },
  });
  await refreshTicketControls(ticket.channel, metadata);
  const logged = await sendTicketLog(
    ticket.channel.guild,
    ticket.config,
    "Ticket reopened",
    ticket.channel,
    metadata,
    interaction.user.id,
    reason || undefined,
  );
  await reply(
    interaction,
    `Ticket reopened.${logged ? "" : " The ticket log could not be sent; ask an administrator to check the log channel."}`,
  );
}

async function updateClaim(
  interaction: TicketInteraction,
  claimed: boolean,
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!isTicketStaff(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only ticket staff or administrators can claim tickets.");
    return;
  }
  if (ticket.metadata.status !== "open") {
    await reply(interaction, "Closed tickets cannot be claimed.");
    return;
  }
  if (claimed && ticket.metadata.claimedBy && ticket.metadata.claimedBy !== interaction.user.id) {
    await reply(
      interaction,
      `This ticket is already claimed by <@${ticket.metadata.claimedBy}>. Unclaim it before assigning it to someone else.`,
    );
    return;
  }
  if (!claimed && !ticket.metadata.claimedBy) {
    await reply(interaction, "This ticket is not currently claimed.");
    return;
  }

  const metadata: TicketMetadata = {
    ...ticket.metadata,
    ...(claimed ? { claimedBy: interaction.user.id } : { claimedBy: undefined }),
  };
  await ticket.channel.setTopic(serializeTicketMetadata(metadata));
  await refreshTicketControls(ticket.channel, metadata);
  const action = claimed ? "Ticket claimed" : "Ticket unclaimed";
  const logged = await sendTicketLog(
    ticket.channel.guild,
    ticket.config,
    action,
    ticket.channel,
    metadata,
    interaction.user.id,
  );
  await reply(
    interaction,
    `${claimed ? "Ticket claimed." : "Ticket unclaimed."}${logged ? "" : " The ticket log could not be sent."}`,
  );
}

async function changeTicketMember(
  interaction: TicketInteraction,
  action: "add" | "remove",
  memberId: string,
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!canAccessTicketControls(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only the ticket owner or authorized staff can change ticket access.");
    return;
  }
  if (ticket.metadata.status !== "open") {
    await reply(interaction, "Ticket access can only be changed while the ticket is open.");
    return;
  }
  if (action === "remove" && memberId === ticket.metadata.ownerId) {
    await reply(interaction, "The ticket owner cannot be removed.");
    return;
  }

  if (action === "add") {
    await ticket.channel.permissionOverwrites.edit(memberId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });
  } else {
    const existing = ticket.channel.permissionOverwrites.cache.get(memberId);
    if (!existing) {
      await reply(
        interaction,
        "That member has no direct ticket access to remove. Access inherited from support roles must be changed by a server manager.",
      );
      return;
    }
    await ticket.channel.permissionOverwrites.delete(memberId);
  }

  const label = action === "add" ? "User added" : "User removed";
  const logged = await sendTicketLog(
    ticket.channel.guild,
    ticket.config,
    label,
    ticket.channel,
    ticket.metadata,
    interaction.user.id,
    `Member: <@${memberId}>.`,
  );
  await ticket.channel.send({
    content: `${action === "add" ? "Added" : "Removed"} <@${memberId}> ${action === "add" ? "to" : "from"} this ticket.`,
    allowedMentions: { users: [memberId], parse: [] },
  });
  await reply(
    interaction,
    `${action === "add" ? "Added" : "Removed"} <@${memberId}> ${action === "add" ? "to" : "from"} the ticket.${logged ? "" : " The ticket log could not be sent."}`,
  );
}

async function showMemberPicker(
  interaction: ButtonInteraction,
  action: "add" | "remove",
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!canAccessTicketControls(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only the ticket owner or authorized staff can change ticket access.");
    return;
  }
  if (ticket.metadata.status !== "open") {
    await reply(interaction, "Ticket access can only be changed while the ticket is open.");
    return;
  }
  const picker = new UserSelectMenuBuilder()
    .setCustomId(`tickets:member-select:${action}:${ticket.channel.id}`)
    .setPlaceholder(action === "add" ? "Choose a member to add" : "Choose a member to remove")
    .setMinValues(1)
    .setMaxValues(1);
  await interaction.reply({
    content: action === "add" ? "Choose a server member to add." : "Choose a member whose direct access should be removed.",
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker)],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function lockTicket(
  interaction: TicketInteraction,
  locked: boolean,
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!isTicketStaff(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only ticket staff or administrators can lock ticket messages.");
    return;
  }
  if (ticket.metadata.status !== "open") {
    await reply(interaction, "Reopen the ticket before changing its lock state.");
    return;
  }
  if (ticket.metadata.locked === locked) {
    await reply(interaction, locked ? "This ticket is already locked." : "This ticket is already unlocked.");
    return;
  }

  await ticket.channel.permissionOverwrites.edit(ticket.metadata.ownerId, {
    SendMessages: !locked,
    AttachFiles: !locked,
  });
  const metadata = { ...ticket.metadata, locked };
  await ticket.channel.setTopic(serializeTicketMetadata(metadata));
  const action = locked ? "Ticket locked" : "Ticket unlocked";
  const logged = await sendTicketLog(
    ticket.channel.guild,
    ticket.config,
    action,
    ticket.channel,
    metadata,
    interaction.user.id,
  );
  await reply(
    interaction,
    `${locked ? "Ticket locked." : "Ticket unlocked."}${logged ? "" : " The ticket log could not be sent."}`,
  );
}

async function sendTranscript(
  interaction: TicketInteraction,
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!canAccessTicketControls(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only the ticket owner or authorized staff can request a transcript.");
    return;
  }
  const result = await createAndSendTranscript(
    ticket.channel.guild,
    ticket.channel,
    ticket.config,
    ticket.metadata,
  );
  if (!result.sent) {
    await reply(
      interaction,
      result.error ?? "I couldn't create or send the transcript. The ticket is unchanged.",
    );
    return;
  }
  await sendTicketLog(
    ticket.channel.guild,
    ticket.config,
    "Transcript created",
    ticket.channel,
    ticket.metadata,
    interaction.user.id,
    `${result.messageCount} messages included; file: ${result.fileName}.`,
  );
  await reply(
    interaction,
    `Transcript created and sent to <#${ticket.config.transcriptChannelId || ticket.config.logChannelId}> (${result.messageCount} messages).`,
  );
}

async function showTicketInfo(interaction: TicketInteraction): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!canAccessTicketControls(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only the ticket owner or authorized staff can view this ticket's information.");
    return;
  }
  const type = ticket.config.ticketTypes.find(
    (ticketType) => ticketType.id === ticket.metadata.typeId,
  );
  const embed = new EmbedBuilder()
    .setTitle("Ticket information")
    .setColor(colorNumber(ticket.config.embedColor))
    .addFields(
      { name: "Channel", value: `<#${ticket.channel.id}>`, inline: true },
      { name: "Status", value: ticket.metadata.status, inline: true },
      { name: "Type", value: type?.label ?? ticket.metadata.typeId, inline: true },
      { name: "Owner / opener", value: `<@${ticket.metadata.ownerId}>`, inline: true },
      {
        name: "Claimed by",
        value: ticket.metadata.claimedBy ? `<@${ticket.metadata.claimedBy}>` : "Unclaimed",
        inline: true,
      },
      {
        name: "Created",
        value: `<t:${Math.floor(ticket.metadata.createdAt / 1000)}:F>`,
        inline: true,
      },
    )
    .setTimestamp();
  if (ticket.metadata.closedAt) {
    embed.addFields({
      name: "Closed",
      value: `<t:${Math.floor(ticket.metadata.closedAt / 1000)}:F> by <@${ticket.metadata.closedBy ?? "0"}>`,
    });
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: "", embeds: [embed] });
  } else {
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function showTicketStats(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await reply(interaction, "Ticket stats are only available in a server.");
    return;
  }
  const config = await getTicketConfig(guild.id);
  if (!config) {
    await reply(interaction, "Run `/ticket setup` first.");
    return;
  }
  if (!isGuildTicketStaff(interaction, config)) {
    await reply(interaction, "Only ticket staff or administrators can view server ticket statistics.");
    return;
  }
  const channels = await guild.channels.fetch();
  const counts = { open: 0, closed: 0 };
  const byType = new Map<string, number>();
  for (const channel of channels?.values() ?? []) {
    if (!isTicketTextChannel(channel)) continue;
    const metadata = parseTicketMetadata(channel.topic);
    if (!metadata) continue;
    counts[metadata.status] += 1;
    byType.set(metadata.typeId, (byType.get(metadata.typeId) ?? 0) + 1);
  }
  const embed = new EmbedBuilder()
    .setTitle(`${guild.name} ticket statistics`)
    .setColor(colorNumber(config.embedColor))
    .addFields(
      { name: "Open tickets", value: String(counts.open), inline: true },
      { name: "Closed tickets", value: String(counts.closed), inline: true },
      {
        name: "By type",
        value:
          [...byType.entries()]
            .map(([typeId, count]) => `\`${typeId}\`: ${count}`)
            .join("\n")
            .slice(0, 1000) || "No tickets yet.",
      },
    )
    .setTimestamp();
  await interaction.editReply({ content: "", embeds: [embed] });
}

async function renameTicket(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const ticket = await getCurrentTicket(interaction);
  if (!ticket) return;
  if (!isTicketStaff(interaction, ticket.config, ticket.metadata)) {
    await reply(interaction, "Only ticket staff or administrators can rename tickets.");
    return;
  }
  const requestedName = interaction.options.getString("name", true);
  const name = sanitizeChannelName(requestedName);
  await ticket.channel.setName(name);
  const logged = await sendTicketLog(
    ticket.channel.guild,
    ticket.config,
    "Ticket renamed",
    ticket.channel,
    ticket.metadata,
    interaction.user.id,
    `New name: #${name}.`,
  );
  await reply(
    interaction,
    `Ticket renamed to \`${name}\`.${logged ? "" : " The ticket log could not be sent."}`,
  );
}

async function handleConfirmedAction(
  interaction: ButtonInteraction,
  action: "close" | "delete",
  requestId: string,
): Promise<void> {
  const pending = pendingActions.get(requestId);
  if (
    !pending ||
    pending.action !== action ||
    pending.userId !== interaction.user.id ||
    pending.guildId !== interaction.guildId
  ) {
    await reply(interaction, "This confirmation expired or belongs to another user. Please try again.");
    return;
  }
  pendingActions.delete(requestId);
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  if (!guild) {
    await reply(interaction, "This action can only be used in a server.");
    return;
  }
  const channel = await guild.channels.fetch(pending.channelId);
  if (!isTicketTextChannel(channel)) {
    await reply(interaction, "This ticket channel no longer exists.");
    return;
  }
  const metadata = parseTicketMetadata(channel.topic);
  const config = await getTicketConfig(guild.id);
  if (!metadata || !config) {
    await reply(interaction, "Ticket metadata or settings are missing; no action was taken.");
    return;
  }
  if (
    action === "close"
      ? !canAccessTicketControls(interaction, config, metadata)
      : !isTicketStaff(interaction, config, metadata)
  ) {
    await reply(interaction, "You no longer have permission to perform this action.");
    return;
  }

  if (action === "close") {
    const result = await closeTicket(
      guild,
      channel,
      config,
      metadata,
      interaction.user.id,
      pending.reason,
    );
    if (!result.closed) {
      await reply(interaction, "This ticket is already closed.");
      return;
    }
    const warnings = [
      !result.transcriptSent ? "the transcript was not sent, so automatic deletion is disabled" : "",
      !result.logSent ? "the closing log could not be sent" : "",
    ].filter(Boolean);
    await reply(
      interaction,
      `Ticket closed.${result.autoDeleteScheduled ? ` It will be deleted after ${config.deleteAfterSeconds} seconds.` : ""}${warnings.length ? ` Note: ${warnings.join("; ")}.` : ""}`,
    );
    return;
  }

  const result = await executeDelete(
    guild,
    channel,
    config,
    metadata,
    interaction.user.id,
    pending.reason,
  );
  await reply(
    interaction,
    result.deleted
      ? "Transcript sent and ticket channel deleted."
      : result.error ?? "The ticket was not deleted.",
  );
}

export async function handleTicketLifecycleCommand(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await reply(interaction, "Tickets can only be used in a server.");
    return;
  }

  if (subcommand === "create" || subcommand === "open") {
    await openTicket(
      interaction,
      guild,
      interaction.options.getString("type") ?? undefined,
    );
    return;
  }
  if (subcommand === "stats") {
    await showTicketStats(interaction);
    return;
  }
  if (subcommand === "close") {
    await requestConfirmation(
      interaction,
      "close",
      interaction.options.getString("reason")?.trim() ?? "",
    );
    return;
  }
  if (subcommand === "delete") {
    await requestConfirmation(
      interaction,
      "delete",
      interaction.options.getString("reason")?.trim() ?? "",
    );
    return;
  }
  if (subcommand === "reopen") {
    await reopenTicket(interaction, interaction.options.getString("reason")?.trim() ?? "");
    return;
  }
  if (subcommand === "claim" || subcommand === "unclaim") {
    await updateClaim(interaction, subcommand === "claim");
    return;
  }
  if (subcommand === "add" || subcommand === "remove") {
    const user = interaction.options.getUser("member", true);
    const member = interaction.options.getMember("member");
    if (!member) {
      await reply(interaction, "Choose a current member of this server.");
      return;
    }
    await changeTicketMember(interaction, subcommand, user.id);
    return;
  }
  if (subcommand === "transcript") {
    await sendTranscript(interaction);
    return;
  }
  if (subcommand === "rename") {
    await renameTicket(interaction);
    return;
  }
  if (subcommand === "info") {
    await showTicketInfo(interaction);
    return;
  }
  if (subcommand === "lock" || subcommand === "unlock") {
    await lockTicket(interaction, subcommand === "lock");
  }
}

export async function handleTicketButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    if (interaction.customId.startsWith("tickets:")) {
      await reply(interaction, "Tickets can only be used in a server.");
    }
    return;
  }

  if (interaction.customId.startsWith(CREATE_TICKET_BUTTON_PREFIX)) {
    const typeId = interaction.customId.slice(CREATE_TICKET_BUTTON_PREFIX.length);
    await openTicket(interaction, guild, typeId);
    return;
  }
  if (interaction.customId === LEGACY_CREATE_TICKET_BUTTON_ID) {
    await openTicket(interaction, guild);
    return;
  }
  if (interaction.customId === CLOSE_TICKET_BUTTON_ID) {
    const ticket = await getCurrentTicket(interaction);
    if (!ticket) return;
    if (!canAccessTicketControls(interaction, ticket.config, ticket.metadata)) {
      await reply(interaction, "Only the ticket owner or authorized staff can close this ticket.");
      return;
    }
    if (ticket.metadata.status !== "open") {
      await reply(interaction, "This ticket is already closed.");
      return;
    }
    await interaction.showModal(createCloseReasonModal(ticket.channel.id));
    return;
  }
  if (interaction.customId === DELETE_TICKET_BUTTON_ID) {
    await requestConfirmation(interaction, "delete");
    return;
  }
  if (interaction.customId === REOPEN_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await reopenTicket(interaction);
    return;
  }
  if (interaction.customId === CLAIM_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await updateClaim(interaction, true);
    return;
  }
  if (interaction.customId === UNCLAIM_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await updateClaim(interaction, false);
    return;
  }
  if (interaction.customId === ADD_TICKET_MEMBER_BUTTON_ID) {
    await showMemberPicker(interaction, "add");
    return;
  }
  if (interaction.customId === REMOVE_TICKET_MEMBER_BUTTON_ID) {
    await showMemberPicker(interaction, "remove");
    return;
  }
  if (interaction.customId === TRANSCRIPT_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await sendTranscript(interaction);
    return;
  }
  if (interaction.customId === LOCK_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await lockTicket(interaction, true);
    return;
  }
  if (interaction.customId === UNLOCK_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await lockTicket(interaction, false);
    return;
  }
  if (interaction.customId.startsWith(CONFIRM_ACTION_PREFIX)) {
    const match = interaction.customId
      .slice(CONFIRM_ACTION_PREFIX.length)
      .match(/^(close|delete):([a-f0-9]+)$/);
    if (!match) {
      await reply(interaction, "This confirmation is invalid.");
      return;
    }
    await handleConfirmedAction(
      interaction,
      match[1] as "close" | "delete",
      match[2],
    );
    return;
  }
  if (interaction.customId.startsWith(CANCEL_ACTION_PREFIX)) {
    const requestId = interaction.customId.split(":").at(-1);
    if (requestId) pendingActions.delete(requestId);
    await interaction.update({
      content: "Action cancelled.",
      components: [],
      allowedMentions: { parse: [] },
    });
  }
}

export async function handleTicketModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.customId.startsWith(`${CLOSE_REASON_MODAL_ID}:`)) return;
  const channelId = interaction.customId.slice(`${CLOSE_REASON_MODAL_ID}:`.length);
  const guild = interaction.guild;
  if (!guild) {
    await reply(interaction, "This action can only be used in a server.");
    return;
  }
  const channel = await guild.channels.fetch(channelId);
  if (!isTicketTextChannel(channel)) {
    await reply(interaction, "This ticket channel no longer exists.");
    return;
  }
  const metadata = parseTicketMetadata(channel.topic);
  const config = await getTicketConfig(guild.id);
  if (!metadata || !config || metadata.status !== "open") {
    await reply(interaction, "This ticket is no longer open.");
    return;
  }
  if (!canAccessTicketControls(interaction, config, metadata)) {
    await reply(interaction, "Only the ticket owner or authorized staff can close this ticket.");
    return;
  }
  const reason = interaction.fields.getTextInputValue("reason").trim();
  const requestId = createPendingAction(
    "close",
    guild.id,
    channel.id,
    interaction.user.id,
    reason,
  );
  await interaction.reply({
    content: "Confirm closing this ticket? A transcript will be generated and sent to the configured channel.",
    components: [createConfirmActionRow("close", requestId)],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

export async function handleTicketUserSelect(
  interaction: UserSelectMenuInteraction,
): Promise<void> {
  const match = interaction.customId.match(
    /^tickets:member-select:(add|remove):(\d+)$/,
  );
  if (!match) return;
  const action = match[1] as "add" | "remove";
  const ticketChannelId = match[2];
  const guild = interaction.guild;
  if (!guild) {
    await reply(interaction, "This action can only be used in a server.");
    return;
  }
  const channel = await guild.channels.fetch(ticketChannelId);
  if (!isTicketTextChannel(channel)) {
    await reply(interaction, "This ticket channel no longer exists.");
    return;
  }
  const metadata = parseTicketMetadata(channel.topic);
  const config = await getTicketConfig(guild.id);
  if (!metadata || !config) {
    await reply(interaction, "Ticket metadata or settings are missing.");
    return;
  }
  const currentChannel = interaction.channel;
  if (
    !canAccessTicketControls(interaction, config, metadata) ||
    metadata.status !== "open"
  ) {
    await reply(interaction, "You can no longer change access to this ticket.");
    return;
  }
  if (currentChannel?.id !== channel.id) {
    await reply(interaction, "This member picker is no longer linked to the current ticket.");
    return;
  }
  const memberId = interaction.values[0];
  if (!memberId) {
    await reply(interaction, "Choose one server member.");
    return;
  }
  await changeTicketMember(interaction, action, memberId);
}

export async function handleTicketConfirmationCommand(
  interaction: ChatInputCommandInteraction,
  action: "close" | "delete",
): Promise<void> {
  await requestConfirmation(
    interaction,
    action,
    interaction.options.getString("reason")?.trim() ?? "",
  );
}