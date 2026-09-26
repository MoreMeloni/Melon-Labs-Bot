import {
  Client,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { getGuildConfig } from "../core/store.js";
import {
  addReminder,
  getCommunityData,
  listReminders,
  removeReminder,
  updateCommunityData,
  type FaqEntry,
  type Reminder,
} from "./store.js";

function isManager(interaction: ChatInputCommandInteraction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

async function reply(
  interaction: ChatInputCommandInteraction,
  content: string,
  ephemeral = true,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, ephemeral });
  }
}

function parseDuration(value: string): number | undefined {
  const match = value.trim().toLowerCase().match(/^(\d{1,6})\s*(s|m|h|d)$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = amount * multipliers[match[2] as keyof typeof multipliers];
  return duration > 0 && duration <= 30 * 86_400_000 ? duration : undefined;
}

function colorNumber(value: string | null): number {
  const normalized = value?.replace(/^#/, "") ?? "";
  return /^[\da-fA-F]{6}$/.test(normalized)
    ? Number.parseInt(normalized, 16)
    : 0x5865f2;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function destinationChannel(
  interaction: ChatInputCommandInteraction,
  configuredId: string | undefined,
): Promise<TextChannel | null> {
  const channel = configuredId
    ? await interaction.guild?.channels.fetch(configuredId).catch(() => null)
    : interaction.channel;
  return channel && channel.isTextBased() && "send" in channel
    ? (channel as TextChannel)
    : null;
}

export async function handleCommunityCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await reply(interaction, "This command can only be used in a server.");
    return;
  }
  const guildId = interaction.guild.id;
  const name = interaction.commandName;
  if (name === "faq") {
    const subcommand = interaction.options.getSubcommand();
    const current = await getCommunityData(guildId);
    if (subcommand === "add") {
      if (!isManager(interaction)) {
        await reply(interaction, "Only server managers can edit the FAQ.");
        return;
      }
      const entry: FaqEntry = {
        id: nextId("faq"),
        question: interaction.options.getString("question", true),
        answer: interaction.options.getString("answer", true),
        createdBy: interaction.user.id,
        createdAt: Date.now(),
      };
      await updateCommunityData(guildId, { faq: [...current.faq, entry] });
      await reply(interaction, `FAQ entry created with ID \`${entry.id}\`.`);
      return;
    }
    if (subcommand === "remove") {
      if (!isManager(interaction)) {
        await reply(interaction, "Only server managers can edit the FAQ.");
        return;
      }
      const id = interaction.options.getString("id", true);
      const next = current.faq.filter((entry) => entry.id !== id);
      await updateCommunityData(guildId, { faq: next });
      await reply(interaction, next.length === current.faq.length ? "FAQ entry not found." : `Removed FAQ entry \`${id}\`.`);
      return;
    }
    const query = subcommand === "search"
      ? interaction.options.getString("query", true).toLowerCase()
      : "";
    const entries = current.faq.filter((entry) =>
      !query ||
      entry.question.toLowerCase().includes(query) ||
      entry.answer.toLowerCase().includes(query),
    );
    await reply(
      interaction,
      entries.length === 0
        ? "No FAQ entries found."
        : entries
            .slice(0, 15)
            .map((entry) => `**${entry.id} — ${entry.question}**\n${entry.answer}`)
            .join("\n\n"),
    );
    return;
  }

  if (name === "rules") {
    const subcommand = interaction.options.getSubcommand();
    const current = await getCommunityData(guildId);
    if (subcommand === "setup") {
      if (!isManager(interaction)) {
        await reply(interaction, "Only server managers can edit server rules.");
        return;
      }
      await updateCommunityData(
        guildId,
        { rules: interaction.options.getString("text", true) },
      );
      await reply(interaction, "Server rules saved.");
      return;
    }
    await reply(interaction, current.rules || "No server rules have been configured yet.");
    return;
  }

  if (name === "remind") {
    const duration = parseDuration(interaction.options.getString("duration", true));
    if (!duration) {
      await reply(interaction, "Use a duration such as `30m`, `2h`, or `1d` (maximum 30 days).");
      return;
    }
    const reminder: Reminder = {
      id: nextId("reminder"),
      guildId,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      text: interaction.options.getString("text", true),
      dueAt: Date.now() + duration,
    };
    await addReminder(reminder);
    await reply(interaction, `Reminder set for <t:${Math.floor(reminder.dueAt / 1000)}:R>.`);
    return;
  }

  if (name === "poll") {
    const options = ["option1", "option2", "option3", "option4", "option5"]
      .map((option) => interaction.options.getString(option))
      .filter((option): option is string => !!option);
    const labels = ["🇦", "🇧", "🇨", "🇩", "🇪"];
    const description = options
      .map((option, index) => `${labels[index]} ${option}`)
      .join("\n");
    const embed = new EmbedBuilder()
      .setTitle(interaction.options.getString("question", true))
      .setDescription(description)
      .setColor(0x5865f2)
      .setFooter({ text: `Poll by ${interaction.user.tag}` })
      .setTimestamp();
    const message = await interaction.reply({ embeds: [embed], fetchReply: true });
    for (const emoji of labels.slice(0, options.length)) {
      await message.react(emoji).catch(() => undefined);
    }
    return;
  }

  if (name === "announce") {
    if (!isManager(interaction)) {
      await reply(interaction, "Only server managers can send announcements.");
      return;
    }
    const target = interaction.options.getChannel("channel", true);
    const channel = interaction.guild.channels.cache.get(target.id);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      await reply(interaction, "Choose a writable text channel.");
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(interaction.options.getString("title", true))
      .setDescription(interaction.options.getString("description", true))
      .setColor(colorNumber(interaction.options.getString("color")))
      .setFooter({ text: interaction.user.tag })
      .setTimestamp();
    await (channel as TextChannel).send({ embeds: [embed] });
    await reply(interaction, `Announcement sent to <#${channel.id}>.`);
    return;
  }

  const config = await getGuildConfig(guildId);
  const text = interaction.options.getString("text", true);
  const target = await destinationChannel(
    interaction,
    name === "suggest" ? config?.channels.suggestion : config?.channels.report,
  );
  if (!target) {
    await reply(interaction, "No writable destination channel is configured.");
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(name === "suggest" ? 0x57f287 : 0xe74c3c)
    .setTitle(name === "suggest" ? "New suggestion" : "New member report")
    .setDescription(
      name === "suggest"
        ? text
        : `Reported user: <@${interaction.options.getUser("user", true).id}>\nReason: ${interaction.options.getString("reason", true)}`,
    )
    .setFooter({ text: `Submitted by ${interaction.user.tag}` })
    .setTimestamp();
  await target.send({ embeds: [embed] });
  await reply(interaction, name === "suggest" ? "Suggestion submitted." : "Report submitted to staff.");
}

export function startReminderScheduler(client: Client): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      const due = (await listReminders()).filter((reminder) => reminder.dueAt <= Date.now());
      for (const reminder of due) {
        await removeReminder(reminder.guildId, reminder.id);
        const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
        if (!channel || !channel.isTextBased() || !("send" in channel)) continue;
        await channel
          .send({
            content: `<@${reminder.userId}> reminder: ${reminder.text}`,
            allowedMentions: { users: [reminder.userId] },
          })
          .catch(() => undefined);
      }
    })().catch((error) => console.error("Reminder scheduler failed:", error));
  }, 15_000);
}