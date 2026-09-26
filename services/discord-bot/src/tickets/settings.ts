import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type NewsChannel,
  type TextChannel,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildBasedChannel,
} from "discord.js";
import { createTicketPanelRows } from "./commands.js";
import {
  createTicketConfig,
  getTicketConfig,
  saveTicketConfig,
  updateTicketConfig,
  type TicketButtonStyle,
  type TicketConfig,
  type TicketTypeConfig,
} from "./store.js";

type SettingsInteraction = ChatInputCommandInteraction;

function isTextChannel(
  channel: GuildBasedChannel | null,
): channel is TextChannel | NewsChannel {
  return (
    channel?.type === ChannelType.GuildText ||
    channel?.type === ChannelType.GuildAnnouncement
  );
}

function hasServerManagement(interaction: SettingsInteraction): boolean {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ??
    false
  );
}

function parseColor(value: string): string | undefined {
  const normalized = value.trim().replace(/^#/, "");
  return /^[\da-fA-F]{6}$/.test(normalized)
    ? `#${normalized.toUpperCase()}`
    : undefined;
}

function parseHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function toColorNumber(value: string): number {
  return Number.parseInt(value.replace("#", ""), 16);
}

async function reply(
  interaction: SettingsInteraction,
  content: string,
): Promise<void> {
  await interaction.editReply({ content });
}

function requireTextSetting(
  interaction: SettingsInteraction,
  name: string,
): string | undefined {
  return interaction.options.getString(name) ?? undefined;
}

async function validateLogPermissions(
  guild: Guild,
  channel: GuildBasedChannel,
): Promise<boolean> {
  const botMember = guild.members.me;
  const permissions = botMember && channel.permissionsFor(botMember);
  return Boolean(
    permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]),
  );
}

async function validateTranscriptPermissions(
  guild: Guild,
  channel: GuildBasedChannel,
): Promise<boolean> {
  const botMember = guild.members.me;
  const permissions = botMember && channel.permissionsFor(botMember);
  return Boolean(
    permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
    ]),
  );
}

function upsertDefaultType(
  config: TicketConfig,
  categoryId: string,
  supportRoleId: string,
): TicketTypeConfig[] {
  const existingDefault = config.ticketTypes.find((type) => type.id === "support");
  const defaultType: TicketTypeConfig = {
    id: "support",
    label: existingDefault?.label ?? config.buttonLabel,
    emoji: existingDefault?.emoji ?? config.buttonEmoji,
    buttonStyle: existingDefault?.buttonStyle ?? config.buttonStyle,
    categoryId,
    supportRoleIds: [supportRoleId],
    welcomeMessage: existingDefault?.welcomeMessage ?? config.welcomeMessage,
    ...(existingDefault?.color ? { color: existingDefault.color } : {}),
  };

  return existingDefault
    ? config.ticketTypes.map((type) =>
        type.id === "support" ? defaultType : type,
      )
    : [defaultType, ...config.ticketTypes];
}

export async function handleTicketSetup(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<void> {
  if (!hasServerManagement(interaction)) {
    await reply(interaction, "Only server managers can configure tickets.");
    return;
  }

  const current = await getTicketConfig(guild.id);
  const categoryOption = interaction.options.getChannel("category");
  const roleOption = interaction.options.getRole("support_role");
  const logOption = interaction.options.getChannel("log_channel");
  const transcriptOption = interaction.options.getChannel("transcript_channel");
  const panelOption = interaction.options.getChannel("panel_channel");

  const [category, supportRole, logChannel, transcriptChannel, panelChannel] =
    await Promise.all([
      categoryOption
        ? guild.channels.fetch(categoryOption.id)
        : Promise.resolve(
            current
              ? await guild.channels.fetch(current.categoryId)
              : null,
          ),
      roleOption
        ? guild.roles.fetch(roleOption.id)
        : Promise.resolve(
            current ? await guild.roles.fetch(current.supportRoleId) : null,
          ),
      logOption
        ? guild.channels.fetch(logOption.id)
        : Promise.resolve(
            current ? await guild.channels.fetch(current.logChannelId) : null,
          ),
      transcriptOption
        ? guild.channels.fetch(transcriptOption.id)
        : Promise.resolve(
            current
              ? await guild.channels.fetch(current.transcriptChannelId)
              : null,
          ),
      panelOption
        ? guild.channels.fetch(panelOption.id)
        : Promise.resolve(
            current?.panelChannelId
              ? await guild.channels.fetch(current.panelChannelId)
              : null,
          ),
    ]);

  if (
    category?.type !== ChannelType.GuildCategory ||
    !supportRole ||
    supportRole.id === guild.id ||
    !isTextChannel(logChannel)
  ) {
    await reply(
      interaction,
      "Initial setup needs a category, a support role other than @everyone, and a text log channel. Existing settings are kept when options are omitted.",
    );
    return;
  }
  if (transcriptOption && !isTextChannel(transcriptChannel)) {
    await reply(interaction, "Choose a text channel for transcripts.");
    return;
  }
  if (panelOption && !isTextChannel(panelChannel)) {
    await reply(interaction, "Choose a text channel for the ticket panel.");
    return;
  }
  const resolvedTranscriptChannel = isTextChannel(transcriptChannel)
    ? transcriptChannel
    : logChannel;
  if (
    (transcriptOption || !current) &&
    !(await validateTranscriptPermissions(guild, resolvedTranscriptChannel))
  ) {
    await reply(
      interaction,
      "The bot needs view, send-message, embed, and attach-files permissions in the transcript channel.",
    );
    return;
  }
  if (
    panelOption &&
    isTextChannel(panelChannel) &&
    !(await validateLogPermissions(guild, panelChannel))
  ) {
    await reply(
      interaction,
      "The bot needs view, send-message, and embed permissions in the panel channel.",
    );
    return;
  }

  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await reply(
      interaction,
      "The bot needs Manage Channels to create, close, and manage tickets.",
    );
    return;
  }
  if (!(await validateLogPermissions(guild, logChannel))) {
    await reply(
      interaction,
      "The bot needs view, send-message, and embed permissions in the log channel.",
    );
    return;
  }

  const nextConfig =
    current ??
    createTicketConfig(category.id, supportRole.id, logChannel.id);
  const updated: TicketConfig = {
    ...nextConfig,
    categoryId: category.id,
    supportRoleId: supportRole.id,
    logChannelId: logChannel.id,
    transcriptChannelId: transcriptChannel?.id ?? logChannel.id,
    ...(panelOption && panelChannel ? { panelChannelId: panelChannel.id } : {}),
    ticketTypes: upsertDefaultType(
      nextConfig,
      category.id,
      supportRole.id,
    ),
  };

  const nameFormat = requireTextSetting(interaction, "name_format");
  const maxOpen = interaction.options.getInteger("max_open_tickets");
  const cooldown = interaction.options.getInteger("cooldown_seconds");
  if (nameFormat !== undefined) updated.nameFormat = nameFormat;
  if (maxOpen !== null) updated.maxOpenTickets = maxOpen;
  if (cooldown !== null) updated.cooldownSeconds = cooldown;

  await saveTicketConfig(guild.id, updated);
  await reply(
    interaction,
    `Ticket settings saved for <#${category.id}>. Support: <@&${supportRole.id}>; logs: <#${logChannel.id}>; transcripts: <#${updated.transcriptChannelId}>. Other ticket settings were preserved.`,
  );
}

export async function postTicketPanel(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<void> {
  if (!hasServerManagement(interaction)) {
    await reply(interaction, "Only server managers can post a ticket panel.");
    return;
  }

  const config = await getTicketConfig(guild.id);
  if (!config) {
    await reply(interaction, "Run `/ticket setup` before posting a panel.");
    return;
  }

  const channelOption = interaction.options.getChannel("channel");
  const channelId =
    channelOption?.id ?? config.panelChannelId ?? interaction.channelId;
  const panelChannel = channelId
    ? await guild.channels.fetch(channelId)
    : null;
  if (!isTextChannel(panelChannel)) {
    await reply(interaction, "Choose a text channel for the ticket panel.");
    return;
  }
  if (!(await validateLogPermissions(guild, panelChannel))) {
    await reply(
      interaction,
      "The bot needs view, send-message, and embed permissions in the panel channel.",
    );
    return;
  }

  const savedConfig =
    config.panelChannelId === panelChannel.id
      ? config
      : await updateTicketConfig(guild.id, {
          panelChannelId: panelChannel.id,
        });
  const embed = new EmbedBuilder().setColor(toColorNumber(savedConfig.embedColor));
  if (savedConfig.panelTitle) embed.setTitle(savedConfig.panelTitle);
  if (savedConfig.panelDescription) {
    embed.setDescription(savedConfig.panelDescription);
  }
  if (savedConfig.panelImageUrl) embed.setImage(savedConfig.panelImageUrl);
  if (savedConfig.panelThumbnailUrl) {
    embed.setThumbnail(savedConfig.panelThumbnailUrl);
  }
  if (savedConfig.footerText) embed.setFooter({ text: savedConfig.footerText });

  const components = createTicketPanelRows(guild, savedConfig);
  if (components.length === 0) {
    await reply(interaction, "Add at least one ticket type before posting a panel.");
    return;
  }
  await panelChannel.send({ embeds: [embed], components });
  await reply(
    interaction,
    `Ticket panel posted in <#${panelChannel.id}>. Run \`/ticket panel\` again after changing its design.`,
  );
}

async function updateGenericSetting(
  interaction: SettingsInteraction,
  guild: Guild,
  config: TicketConfig,
): Promise<string | undefined> {
  const setting = interaction.options.getString("setting", true);
  const value = interaction.options.getString("value", true).trim();
  const update: Partial<TicketConfig> = {};

  switch (setting) {
    case "panel_title":
      if (!value || value.length > 256) {
        return "Panel titles must be 1–256 characters.";
      }
      update.panelTitle = value;
      break;
    case "panel_description":
      if (value !== "none" && value.length > 4000) {
        return "Panel descriptions must be at most 4000 characters, or use `none` to clear them.";
      }
      update.panelDescription = value.toLowerCase() === "none" ? "" : value;
      break;
    case "panel_image_url":
      update.panelImageUrl =
        value.toLowerCase() === "none" ? undefined : parseHttpUrl(value);
      if (value.toLowerCase() !== "none" && !update.panelImageUrl) {
        return "Use an HTTP or HTTPS image URL, or enter `none` to clear it.";
      }
      break;
    case "panel_thumbnail_url":
      update.panelThumbnailUrl =
        value.toLowerCase() === "none" ? undefined : parseHttpUrl(value);
      if (value.toLowerCase() !== "none" && !update.panelThumbnailUrl) {
        return "Use an HTTP or HTTPS image URL, or enter `none` to clear it.";
      }
      break;
    case "footer_text":
      if (value !== "none" && value.length > 2048) {
        return "Footer text must be at most 2048 characters, or use `none` to clear it.";
      }
      update.footerText = value.toLowerCase() === "none" ? "" : value;
      break;
    case "embed_color": {
      const color = parseColor(value);
      if (!color) return "Enter a six-digit hex color such as `#5865F2`.";
      update.embedColor = color;
      break;
    }
    case "button_label":
      if (!value || value.length > 80) return "Button labels must be 1–80 characters.";
      update.buttonLabel = value;
      break;
    case "button_emoji":
      if (!value) return "Enter a Unicode emoji or Discord emoji ID.";
      update.buttonEmoji = value;
      break;
    case "button_style":
      if (!["primary", "secondary", "success", "danger"].includes(value)) {
        return "Style must be primary, secondary, success, or danger.";
      }
      update.buttonStyle = value as TicketButtonStyle;
      break;
    case "welcome_message":
      if (value.length > 1500) return "Welcome messages must be at most 1500 characters.";
      update.welcomeMessage = value;
      break;
    case "closing_message":
      if (value.length > 1500) return "Closing messages must be at most 1500 characters.";
      update.closingMessage = value;
      break;
    case "name_format":
      if (!value || value.length > 100) return "The name format must be 1–100 characters.";
      update.nameFormat = value;
      break;
    case "max_open_tickets": {
      const max = Number.parseInt(value, 10);
      if (!Number.isInteger(max) || max < 1 || max > 25) {
        return "Maximum open tickets must be between 1 and 25.";
      }
      update.maxOpenTickets = max;
      break;
    }
    case "cooldown_seconds": {
      const seconds = Number.parseInt(value, 10);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
        return "Cooldown must be between 0 and 86400 seconds.";
      }
      update.cooldownSeconds = seconds;
      break;
    }
    case "delete_after_seconds": {
      const seconds = Number.parseInt(value, 10);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 2147000) {
        return "Auto-delete delay must be between 0 and 2147000 seconds.";
      }
      update.deleteAfterSeconds = seconds;
      break;
    }
    default:
      return "That setting is not supported.";
  }

  const ticketTypes = config.ticketTypes.map((ticketType) =>
    ticketType.id === "support"
      ? {
          ...ticketType,
          ...(update.buttonLabel !== undefined
            ? { label: update.buttonLabel }
            : {}),
          ...(update.buttonEmoji !== undefined
            ? { emoji: update.buttonEmoji }
            : {}),
          ...(update.buttonStyle !== undefined
            ? { buttonStyle: update.buttonStyle }
            : {}),
          ...(update.welcomeMessage !== undefined
            ? { welcomeMessage: update.welcomeMessage }
            : {}),
        }
      : ticketType,
  );
  await updateTicketConfig(guild.id, { ...update, ticketTypes });
  return `Updated \`${setting}\`. Other server settings were left unchanged.`;
}

async function configurePanel(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const update: Partial<TicketConfig> = {};
  const channelOption = interaction.options.getChannel("channel");
  if (channelOption) {
    const channel = await guild.channels.fetch(channelOption.id);
    if (!isTextChannel(channel)) return "Choose a text channel for the panel.";
    update.panelChannelId = channel.id;
  }

  const title = interaction.options.getString("title");
  const description = interaction.options.getString("description");
  const imageUrl = interaction.options.getString("image_url");
  const thumbnailUrl = interaction.options.getString("thumbnail_url");
  const footer = interaction.options.getString("footer");
  const colorValue = interaction.options.getString("color");

  if (title !== null) update.panelTitle = title;
  if (description !== null) update.panelDescription = description;
  if (imageUrl !== null) {
    update.panelImageUrl =
      imageUrl.toLowerCase() === "none" ? undefined : parseHttpUrl(imageUrl);
    if (imageUrl.toLowerCase() !== "none" && !update.panelImageUrl) {
      return "The panel image must be an HTTP or HTTPS URL, or `none` to clear it.";
    }
  }
  if (thumbnailUrl !== null) {
    update.panelThumbnailUrl =
      thumbnailUrl.toLowerCase() === "none"
        ? undefined
        : parseHttpUrl(thumbnailUrl);
    if (thumbnailUrl.toLowerCase() !== "none" && !update.panelThumbnailUrl) {
      return "The thumbnail must be an HTTP or HTTPS URL, or `none` to clear it.";
    }
  }
  if (footer !== null) {
    update.footerText = footer.toLowerCase() === "none" ? "" : footer;
  }
  if (colorValue !== null) {
    const color = parseColor(colorValue);
    if (!color) return "Enter a six-digit hex color such as `#5865F2`.";
    update.embedColor = color;
  }
  if (Object.keys(update).length === 0) {
    return "Choose at least one panel setting to update.";
  }

  await updateTicketConfig(guild.id, update);
  return "Panel settings updated. Run `/ticket panel` to post the updated design.";
}

async function configureLimits(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const update: Partial<TicketConfig> = {};
  const maxOpen = interaction.options.getInteger("max_open");
  const cooldown = interaction.options.getInteger("cooldown_seconds");
  const deleteAfter = interaction.options.getInteger("delete_after_seconds");
  if (maxOpen !== null) update.maxOpenTickets = maxOpen;
  if (cooldown !== null) update.cooldownSeconds = cooldown;
  if (deleteAfter !== null) update.deleteAfterSeconds = deleteAfter;
  if (Object.keys(update).length === 0) {
    return "Choose at least one limit to update.";
  }
  await updateTicketConfig(guild.id, update);
  return "Ticket limits updated without changing other settings.";
}

async function configureMessages(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const update: Partial<TicketConfig> = {};
  const welcome = interaction.options.getString("welcome");
  const closing = interaction.options.getString("closing");
  if (welcome !== null) update.welcomeMessage = welcome;
  if (closing !== null) update.closingMessage = closing;
  if (Object.keys(update).length === 0) {
    return "Choose a welcome or closing message to update.";
  }
  await updateTicketConfig(guild.id, update);
  return "Ticket messages updated.";
}

async function configureButton(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const update: Partial<TicketConfig> = {};
  const label = interaction.options.getString("label");
  const emoji = interaction.options.getString("emoji");
  const style = interaction.options.getString("style");
  if (label !== null) {
    if (!label.trim()) return "Button label cannot be empty.";
    update.buttonLabel = label.trim();
  }
  if (emoji !== null) update.buttonEmoji = emoji;
  if (style !== null) update.buttonStyle = style as TicketButtonStyle;
  if (Object.keys(update).length === 0) {
    return "Choose a button label, emoji, or style to update.";
  }
  const config = await updateTicketConfig(guild.id, update);
  const types = config.ticketTypes.map((type) =>
    type.id === "support"
      ? {
          ...type,
          label: update.buttonLabel ?? type.label,
          emoji: update.buttonEmoji ?? type.emoji,
          buttonStyle: update.buttonStyle ?? type.buttonStyle,
        }
      : type,
  );
  await updateTicketConfig(guild.id, { ticketTypes: types });
  return "Default ticket button updated.";
}

async function updateStaffRole(
  interaction: SettingsInteraction,
  guild: Guild,
  action: "add" | "remove",
): Promise<string> {
  const roleOption = interaction.options.getRole("role", true);
  const role = await guild.roles.fetch(roleOption.id);
  if (!role || role.id === guild.id) {
    return "Choose a valid server role other than @everyone.";
  }
  const config = await getTicketConfig(guild.id);
  if (!config) return "Run `/ticket setup` first.";

  if (action === "add") {
    if (config.staffRoleIds.includes(role.id)) return "That role is already staff.";
    if (config.staffRoleIds.length >= 10) {
      return "A server can configure at most 10 additional staff roles.";
    }
    await updateTicketConfig(guild.id, {
      staffRoleIds: [...config.staffRoleIds, role.id],
    });
    return `Added <@&${role.id}> as ticket staff.`;
  }

  if (role.id === config.supportRoleId) {
    return "Update the default support role with `/ticket setup`; it cannot be removed here.";
  }
  if (!config.staffRoleIds.includes(role.id)) {
    return "That role is not configured as ticket staff.";
  }
  await updateTicketConfig(guild.id, {
    staffRoleIds: config.staffRoleIds.filter((roleId) => roleId !== role.id),
  });
  return `Removed <@&${role.id}> from global ticket staff.`;
}

async function configureTranscriptChannel(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const option = interaction.options.getChannel("channel", true);
  const channel = await guild.channels.fetch(option.id);
  if (!isTextChannel(channel)) return "Choose a text channel for transcripts.";
  if (!(await validateTranscriptPermissions(guild, channel))) {
    return "The bot needs view, send-message, embed, and attach-files permissions in the transcript channel.";
  }
  await updateTicketConfig(guild.id, { transcriptChannelId: channel.id });
  return `Transcripts will be sent to <#${channel.id}>.`;
}

function isValidTypeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,23}$/.test(id);
}

async function addTicketType(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const config = await getTicketConfig(guild.id);
  if (!config) return "Run `/ticket setup` first.";
  if (config.ticketTypes.length >= 25) {
    return "Discord panels support up to 25 ticket buttons.";
  }

  const id = interaction.options.getString("id", true).trim().toLowerCase();
  if (!isValidTypeId(id)) {
    return "Type IDs must be 2–24 characters using lowercase letters, numbers, hyphens, or underscores.";
  }
  if (config.ticketTypes.some((type) => type.id === id)) {
    return "A ticket type with that ID already exists.";
  }

  const label = interaction.options.getString("label", true).trim();
  const categoryOption = interaction.options.getChannel("category", true);
  const supportOption = interaction.options.getRole("support_role", true);
  const [category, supportRole] = await Promise.all([
    guild.channels.fetch(categoryOption.id),
    guild.roles.fetch(supportOption.id),
  ]);
  if (
    category?.type !== ChannelType.GuildCategory ||
    !supportRole ||
    supportRole.id === guild.id
  ) {
    return "Choose a valid category and support role.";
  }
  const style =
    (interaction.options.getString("style") as TicketButtonStyle | null) ??
    config.buttonStyle;
  const colorInput = interaction.options.getString("color");
  const color = colorInput ? parseColor(colorInput) : undefined;
  if (colorInput && !color) {
    return "Enter a six-digit hex color such as `#5865F2`.";
  }

  const ticketType: TicketTypeConfig = {
    id,
    label,
    emoji:
      interaction.options.getString("emoji")?.trim() || config.buttonEmoji,
    buttonStyle: style,
    categoryId: category.id,
    supportRoleIds: [supportRole.id],
    welcomeMessage:
      interaction.options.getString("welcome") ?? config.welcomeMessage,
    ...(color ? { color } : {}),
  };
  await updateTicketConfig(guild.id, {
    ticketTypes: [...config.ticketTypes, ticketType],
  });
  return `Added ticket type **${label}** (\`${id}\`). Run \`/ticket panel\` to show its button.`;
}

async function editTicketType(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const config = await getTicketConfig(guild.id);
  if (!config) return "Run `/ticket setup` first.";
  const id = interaction.options.getString("id", true).trim().toLowerCase();
  const existing = config.ticketTypes.find((type) => type.id === id);
  if (!existing) return "That ticket type does not exist.";

  const update: Partial<TicketTypeConfig> = {};
  const label = interaction.options.getString("label");
  const emoji = interaction.options.getString("emoji");
  const style = interaction.options.getString("style");
  const welcome = interaction.options.getString("welcome");
  const colorInput = interaction.options.getString("color");
  const categoryOption = interaction.options.getChannel("category");
  const supportOption = interaction.options.getRole("support_role");

  if (label !== null) update.label = label;
  if (emoji !== null) update.emoji = emoji;
  if (style !== null) update.buttonStyle = style as TicketButtonStyle;
  if (welcome !== null) update.welcomeMessage = welcome;
  if (colorInput !== null) {
    const color = parseColor(colorInput);
    if (!color) return "Enter a six-digit hex color such as `#5865F2`.";
    update.color = color;
  }
  if (categoryOption) {
    const category = await guild.channels.fetch(categoryOption.id);
    if (category?.type !== ChannelType.GuildCategory) {
      return "Choose a valid ticket category.";
    }
    update.categoryId = category.id;
  }
  if (supportOption) {
    const role = await guild.roles.fetch(supportOption.id);
    if (!role || role.id === guild.id) return "Choose a valid support role.";
    update.supportRoleIds = [role.id];
  }

  const ticketTypes = config.ticketTypes.map((type) =>
    type.id === id ? { ...type, ...update } : type,
  );
  await updateTicketConfig(guild.id, { ticketTypes });
  return `Ticket type \`${id}\` updated. Run \`/ticket panel\` to refresh the panel.`;
}

async function removeTicketType(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const config = await getTicketConfig(guild.id);
  if (!config) return "Run `/ticket setup` first.";
  const id = interaction.options.getString("id", true).trim().toLowerCase();
  if (!config.ticketTypes.some((type) => type.id === id)) {
    return "That ticket type does not exist.";
  }
  if (config.ticketTypes.length <= 1) {
    return "At least one ticket type must remain configured.";
  }
  await updateTicketConfig(guild.id, {
    ticketTypes: config.ticketTypes.filter((type) => type.id !== id),
  });
  return `Removed ticket type \`${id}\`. Existing tickets remain unchanged; run \`/ticket panel\` to refresh the panel.`;
}

async function listTicketTypes(
  interaction: SettingsInteraction,
  guild: Guild,
): Promise<string> {
  const config = await getTicketConfig(guild.id);
  if (!config) return "Run `/ticket setup` first.";
  return config.ticketTypes
    .map(
      (type) =>
        `${type.emoji} **${type.label}** (\`${type.id}\`) — <#${type.categoryId}> — ${type.supportRoleIds.map((id) => `<@&${id}>`).join(", ")}`,
    )
    .join("\n")
    .slice(0, 1900);
}

export async function handleTicketSettings(
  interaction: SettingsInteraction,
  guild: Guild,
  subcommand: string,
): Promise<void> {
  if (!hasServerManagement(interaction)) {
    await reply(interaction, "Only server managers can change ticket settings.");
    return;
  }

  if (subcommand === "setup") {
    await handleTicketSetup(interaction, guild);
    return;
  }
  if (subcommand === "panel") {
    await postTicketPanel(interaction, guild);
    return;
  }

  const config = await getTicketConfig(guild.id);
  if (!config) {
    await reply(interaction, "Run `/ticket setup` with a category, support role, and log channel first.");
    return;
  }

  let result: string;
  switch (subcommand) {
    case "config":
      result =
        (await updateGenericSetting(interaction, guild, config)) ??
        "Setting updated.";
      break;
    case "config-panel":
      result = await configurePanel(interaction, guild);
      break;
    case "config-limits":
      result = await configureLimits(interaction, guild);
      break;
    case "config-messages":
      result = await configureMessages(interaction, guild);
      break;
    case "config-button":
      result = await configureButton(interaction, guild);
      break;
    case "config-staff-add":
      result = await updateStaffRole(interaction, guild, "add");
      break;
    case "config-staff-remove":
      result = await updateStaffRole(interaction, guild, "remove");
      break;
    case "config-transcript":
      result = await configureTranscriptChannel(interaction, guild);
      break;
    case "type-add":
      result = await addTicketType(interaction, guild);
      break;
    case "type-edit":
      result = await editTicketType(interaction, guild);
      break;
    case "type-remove":
      result = await removeTicketType(interaction, guild);
      break;
    case "type-list":
      result = await listTicketTypes(interaction, guild);
      break;
    default:
      return;
  }

  await reply(interaction, result);
}