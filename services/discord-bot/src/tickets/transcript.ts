import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
} from "discord.js";
import type { TicketConfig } from "./store.js";
import type { TicketMetadata } from "./metadata.js";

type TranscriptResult = {
  path: string;
  fileName: string;
  messageCount: number;
  sent: boolean;
  error?: string;
};

function isSendableTextChannel(
  channel: GuildBasedChannel | null,
): channel is GuildBasedChannel & Pick<TextChannel, "send"> {
  return (
    channel?.type === ChannelType.GuildText ||
    channel?.type === ChannelType.GuildAnnouncement
  );
}

function safeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/`/g, "'");
}

async function collectMessages(channel: TextChannel): Promise<
  {
    createdTimestamp: number;
    author: { id: string; tag: string; bot: boolean };
    content: string;
    attachments: string[];
    embeds: string[];
  }[]
> {
  const collected: Awaited<ReturnType<typeof collectMessages>> = [];
  let before: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    if (messages.size === 0) break;

    for (const message of messages.values()) {
      collected.push({
        createdTimestamp: message.createdTimestamp,
        author: {
          id: message.author.id,
          tag: message.author.tag,
          bot: message.author.bot,
        },
        content: message.content,
        attachments: message.attachments.map((attachment) => attachment.url),
        embeds: message.embeds.map((embed) =>
          [
            embed.title,
            embed.description,
            ...embed.fields.map((field) => `${field.name}: ${field.value}`),
          ]
            .filter(Boolean)
            .join(" | "),
        ),
      });
    }

    const oldest = messages.last();
    if (!oldest || messages.size < 100) break;
    before = oldest.id;
  }

  return collected.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
}

export async function createAndSendTranscript(
  guild: Guild,
  channel: TextChannel,
  config: TicketConfig,
  metadata: TicketMetadata,
): Promise<TranscriptResult> {
  const messages = await collectMessages(channel);
  const filename = `${guild.id}-${channel.id}-${Date.now()}.txt`;
  const folder = resolve(
    process.env.TICKET_TRANSCRIPT_DIR ?? "data/transcripts",
  );
  const path = resolve(folder, filename);

  const header = [
    `Ticket transcript: #${channel.name}`,
    `Server: ${safeLine(guild.name)} (${guild.id})`,
    `Channel: ${channel.id}`,
    `Ticket owner / opener: ${metadata.ownerId}`,
    `Ticket type: ${metadata.typeId}`,
    `Support role IDs: ${metadata.supportRoleIds.join(", ") || config.supportRoleId}`,
    `Claimed by: ${metadata.claimedBy ?? "unclaimed"}`,
    `Created: ${new Date(metadata.createdAt).toISOString()}`,
    ...(metadata.closedAt
      ? [`Closed: ${new Date(metadata.closedAt).toISOString()}`]
      : []),
    ...(metadata.closedBy ? [`Closed by: ${metadata.closedBy}`] : []),
    `Generated: ${new Date().toISOString()}`,
    `Messages included: ${messages.length}`,
    "",
    "-------------------- Messages --------------------",
    "",
  ];
  const body = messages.map((message) => {
    const date = new Date(message.createdTimestamp).toISOString();
    const author = `${safeLine(message.author.tag)} (${message.author.id})${message.author.bot ? " [bot]" : ""}`;
    const content = safeLine(message.content || "[no text content]");
    const attachments = message.attachments.length
      ? `\n  Attachments: ${message.attachments.join(" | ")}`
      : "";
    const embeds = message.embeds.length
      ? `\n  Embeds: ${message.embeds.map(safeLine).join(" | ")}`
      : "";
    return `[${date}] ${author}\n${content}${attachments}${embeds}`;
  });
  const transcript = `${[...header, ...body].join("\n")}\n`;

  try {
    await mkdir(folder, { recursive: true });
    await writeFile(path, transcript, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    return {
      path: "",
      fileName: filename,
      messageCount: messages.length,
      sent: false,
      error: `Could not save the transcript file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const transcriptChannelId =
    config.transcriptChannelId || config.logChannelId;
  const transcriptChannel = await guild.channels.fetch(transcriptChannelId);
  if (!isSendableTextChannel(transcriptChannel)) {
    return {
      path,
      fileName: filename,
      messageCount: messages.length,
      sent: false,
      error: "The configured transcript channel is missing or is not a text channel.",
    };
  }

  const botMember = guild.members.me;
  const permissions = botMember && transcriptChannel.permissionsFor(botMember);
  if (
    !permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    return {
      path,
      fileName: filename,
      messageCount: messages.length,
      sent: false,
      error:
        "The bot needs view, send-message, attach-files, and embed permissions in the transcript channel.",
    };
  }

  const owner = await guild.members.fetch(metadata.ownerId).catch(() => undefined);
  const embed = new EmbedBuilder()
    .setTitle("Ticket transcript")
    .setDescription(
      `Transcript for <#${channel.id}> (${channel.name})\nOwner: ${owner ? `<@${owner.id}>` : metadata.ownerId}\nType: \`${metadata.typeId}\`\nMessages: ${messages.length}`,
    )
    .setColor(0x5865f2)
    .setTimestamp();

  try {
    await transcriptChannel.send({
      embeds: [embed],
      files: [new AttachmentBuilder(Buffer.from(transcript, "utf8"), { name: filename })],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    return {
      path,
      fileName: filename,
      messageCount: messages.length,
      sent: false,
      error: `Transcript saved locally but could not be sent to the transcript channel: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    path,
    fileName: filename,
    messageCount: messages.length,
    sent: true,
  };
}