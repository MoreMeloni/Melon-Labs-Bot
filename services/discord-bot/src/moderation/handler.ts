import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { getGuildConfig } from "../core/store.js";
import { addWarning, getWarnings, removeWarning } from "./store.js";

function canUse(
  interaction: ChatInputCommandInteraction,
  permission: bigint,
): boolean {
  return Boolean(interaction.memberPermissions?.has(permission));
}

function reason(interaction: ChatInputCommandInteraction): string {
  return (
    interaction.options.getString("reason")?.trim() ||
    `Action by ${interaction.user.tag}`
  );
}

async function reply(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

async function logAction(
  interaction: ChatInputCommandInteraction,
  title: string,
  description: string,
): Promise<void> {
  const config = interaction.guild
    ? await getGuildConfig(interaction.guild.id)
    : undefined;
  const channelId = config?.channels.moderationLog ?? config?.channels.log;
  if (!interaction.guild || !channelId) return;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !("send" in channel)) return;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xe74c3c)
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

async function fetchMember(
  interaction: ChatInputCommandInteraction,
): Promise<GuildMember | null> {
  const user = interaction.options.getUser("user", true);
  return interaction.guild?.members.fetch(user.id).catch(() => null) ?? null;
}

function hierarchyError(
  interaction: ChatInputCommandInteraction,
  member: GuildMember,
): string | undefined {
  if (member.id === interaction.user.id) return "You cannot moderate yourself.";
  if (member.id === interaction.guild?.ownerId) return "The server owner cannot be moderated.";
  const actor = interaction.guild?.members.cache.get(interaction.user.id);
  if (actor && member.roles.highest.position >= actor.roles.highest.position) {
    return "That member has an equal or higher role than you.";
  }
  return undefined;
}

export async function handleModerationCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await reply(interaction, "Moderation commands can only be used in a server.");
    return;
  }
  const name = interaction.commandName;
  if (name === "warnings") {
    const user = interaction.options.getUser("user", true);
    const warnings = await getWarnings(interaction.guild.id, user.id);
    await reply(
      interaction,
      warnings.length === 0
        ? `${user.tag} has no warnings.`
        : warnings
            .slice(0, 10)
            .map(
              (warning) =>
                `\`${warning.id}\` — ${new Date(warning.createdAt).toISOString()} — <@${warning.moderatorId}>: ${warning.reason}`,
            )
            .join("\n"),
    );
    return;
  }
  if (name === "warn") {
    if (!canUse(interaction, PermissionFlagsBits.ModerateMembers)) {
      await reply(interaction, "You need Moderate Members to warn users.");
      return;
    }
    const member = await fetchMember(interaction);
    if (!member) {
      await reply(interaction, "That member is not available.");
      return;
    }
    const error = hierarchyError(interaction, member);
    if (error) {
      await reply(interaction, error);
      return;
    }
    const warning = await addWarning({
      guildId: interaction.guild.id,
      userId: member.id,
      moderatorId: interaction.user.id,
      reason: interaction.options.getString("reason", true).trim(),
    });
    await reply(interaction, `Warned **${member.user.tag}**. Warning ID: \`${warning.id}\`.`);
    await logAction(
      interaction,
      "Member warned",
      `User: <@${member.id}>\nModerator: <@${interaction.user.id}>\nReason: ${warning.reason}\nWarning ID: \`${warning.id}\``,
    );
    return;
  }
  if (name === "unwarn") {
    if (!canUse(interaction, PermissionFlagsBits.ModerateMembers)) {
      await reply(interaction, "You need Moderate Members to remove warnings.");
      return;
    }
    const user = interaction.options.getUser("user", true);
    const id = interaction.options.getString("warning_id", true);
    const removed = await removeWarning(interaction.guild.id, user.id, id);
    await reply(interaction, removed ? `Removed warning \`${id}\`.` : "Warning ID not found.");
    return;
  }

  if (name === "clear") {
    if (!canUse(interaction, PermissionFlagsBits.ManageMessages)) {
      await reply(interaction, "You need Manage Messages to clear messages.");
      return;
    }
    const channel = interaction.channel;
    if (!channel || !("bulkDelete" in channel)) {
      await reply(interaction, "This command requires a text channel.");
      return;
    }
    const amount = interaction.options.getInteger("amount", true);
    const deleted = await (channel as TextChannel).bulkDelete(amount, true);
    await reply(interaction, `Deleted ${deleted.size} message(s).`);
    return;
  }

  if (name === "slowmode") {
    if (!canUse(interaction, PermissionFlagsBits.ManageChannels)) {
      await reply(interaction, "You need Manage Channels to change slowmode.");
      return;
    }
    const channel = interaction.channel;
    if (!channel || !("setRateLimitPerUser" in channel)) {
      await reply(interaction, "This command requires a text channel.");
      return;
    }
    const seconds = interaction.options.getInteger("seconds", true);
    await channel.setRateLimitPerUser(seconds, reason(interaction));
    await reply(interaction, `Slowmode set to ${seconds} seconds.`);
    return;
  }

  if (name === "lock" || name === "unlock") {
    if (!canUse(interaction, PermissionFlagsBits.ManageChannels)) {
      await reply(interaction, "You need Manage Channels to lock channels.");
      return;
    }
    const channel = interaction.channel;
    if (!channel || !("permissionOverwrites" in channel)) {
      await reply(interaction, "This command requires a guild channel.");
      return;
    }
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: name === "unlock" ? null : false,
    });
    await reply(interaction, name === "lock" ? "Channel locked." : "Channel unlocked.");
    return;
  }

  if (name === "unban") {
    if (!canUse(interaction, PermissionFlagsBits.BanMembers)) {
      await reply(interaction, "You need Ban Members to unban users.");
      return;
    }
    const userId = interaction.options.getString("user_id", true).trim();
    await interaction.guild.members.unban(userId, reason(interaction));
    await reply(interaction, `Unbanned \`${userId}\`.`);
    return;
  }

  if (name === "role") {
    if (!canUse(interaction, PermissionFlagsBits.ManageRoles)) {
      await reply(interaction, "You need Manage Roles to manage member roles.");
      return;
    }
    const member = await fetchMember(interaction);
    const role = interaction.options.getRole("role", true);
    const managedRole = interaction.guild.roles.cache.get(role.id);
    if (!member || !managedRole) {
      await reply(interaction, "The member or role is not available.");
      return;
    }
    const actor = interaction.guild.members.cache.get(interaction.user.id);
    if (
      managedRole.managed ||
      !actor ||
      managedRole.position >= actor.roles.highest.position
    ) {
      await reply(interaction, "You cannot manage that role.");
      return;
    }
    const action = interaction.options.getString("action", true);
    if (action === "add") await member.roles.add(managedRole, reason(interaction));
    else await member.roles.remove(managedRole, reason(interaction));
    await reply(interaction, `${action === "add" ? "Added" : "Removed"} <@&${managedRole.id}> ${action === "add" ? "to" : "from"} <@${member.id}>.`);
    return;
  }

  const member = await fetchMember(interaction);
  if (!member) {
    await reply(interaction, "That member is not available.");
    return;
  }
  const error = hierarchyError(interaction, member);
  if (error) {
    await reply(interaction, error);
    return;
  }
  if (name === "ban" || name === "softban") {
    if (!canUse(interaction, PermissionFlagsBits.BanMembers)) {
      await reply(interaction, "You need Ban Members to ban users.");
      return;
    }
    await member.ban({
      deleteMessageSeconds: name === "softban" ? 604800 : 0,
      reason: reason(interaction),
    });
    if (name === "softban") await interaction.guild.members.unban(member.id, reason(interaction));
    await reply(interaction, `${name === "softban" ? "Softbanned" : "Banned"} **${member.user.tag}**.`);
    await logAction(interaction, name === "softban" ? "Member softbanned" : "Member banned", `User: <@${member.id}>\nModerator: <@${interaction.user.id}>\nReason: ${reason(interaction)}`);
    return;
  }
  if (name === "kick") {
    if (!canUse(interaction, PermissionFlagsBits.KickMembers)) {
      await reply(interaction, "You need Kick Members to kick users.");
      return;
    }
    await member.kick(reason(interaction));
    await reply(interaction, `Kicked **${member.user.tag}**.`);
    return;
  }
  if (name === "timeout" || name === "untimeout") {
    if (!canUse(interaction, PermissionFlagsBits.ModerateMembers)) {
      await reply(interaction, "You need Moderate Members to timeout users.");
      return;
    }
    const minutes = interaction.options.getInteger("minutes") ?? 0;
    await member.timeout(name === "timeout" ? minutes * 60_000 : null, reason(interaction));
    await reply(interaction, name === "timeout" ? `Timed out **${member.user.tag}** for ${minutes} minute(s).` : `Removed timeout from **${member.user.tag}**.`);
    return;
  }
  if (name === "nick") {
    if (!canUse(interaction, PermissionFlagsBits.ManageNicknames)) {
      await reply(interaction, "You need Manage Nicknames to change nicknames.");
      return;
    }
    const nickname = interaction.options.getString("nickname", true);
    await member.setNickname(nickname.toLowerCase() === "none" ? null : nickname, reason(interaction));
    await reply(interaction, "Nickname updated.");
  }
}