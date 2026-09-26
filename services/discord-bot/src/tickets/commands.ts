import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
} from "discord.js";
import type { TicketButtonStyle, TicketConfig } from "./store.js";

export const TICKET_BUTTON_PREFIX = "tickets:";
export const LEGACY_CREATE_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}create`;
export const CREATE_TICKET_BUTTON_PREFIX = `${TICKET_BUTTON_PREFIX}create:`;
export const CLOSE_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}close`;
export const REOPEN_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}reopen`;
export const DELETE_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}delete`;
export const CLAIM_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}claim`;
export const UNCLAIM_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}unclaim`;
export const ADD_TICKET_MEMBER_BUTTON_ID = `${TICKET_BUTTON_PREFIX}add-member`;
export const REMOVE_TICKET_MEMBER_BUTTON_ID = `${TICKET_BUTTON_PREFIX}remove-member`;
export const TRANSCRIPT_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}transcript`;
export const LOCK_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}lock`;
export const UNLOCK_TICKET_BUTTON_ID = `${TICKET_BUTTON_PREFIX}unlock`;
export const CLOSE_REASON_MODAL_ID = `${TICKET_BUTTON_PREFIX}close-reason`;
export const MEMBER_MODAL_PREFIX = `${TICKET_BUTTON_PREFIX}member-modal:`;
export const CONFIRM_ACTION_PREFIX = `${TICKET_BUTTON_PREFIX}confirm:`;
export const CANCEL_ACTION_PREFIX = `${TICKET_BUTTON_PREFIX}cancel:`;

const buttonStyles: Record<TicketButtonStyle, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const settingChoices = [
  ["panel_title", "Panel title"],
  ["panel_description", "Panel description"],
  ["panel_image_url", "Panel banner image URL"],
  ["panel_thumbnail_url", "Panel thumbnail URL"],
  ["footer_text", "Panel footer"],
  ["embed_color", "Embed color (hex)"],
  ["button_label", "Default button label"],
  ["button_emoji", "Default button emoji or emoji ID"],
  ["button_style", "Default button style"],
  ["welcome_message", "Default welcome message"],
  ["closing_message", "Closing message"],
  ["name_format", "Channel name format"],
  ["max_open_tickets", "Maximum open tickets per member"],
  ["cooldown_seconds", "Member ticket cooldown in seconds"],
  ["delete_after_seconds", "Delete closed tickets after seconds (0 disables)"],
] as const;

export const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Configure and manage private support tickets.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
      .setDescription("Create or update ticket settings without resetting other options.")
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("Default category for new tickets.")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(false),
      )
      .addRoleOption((option) =>
        option
          .setName("support_role")
          .setDescription("Default support role for new tickets.")
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName("log_channel")
          .setDescription("Text channel for ticket event logs.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName("transcript_channel")
          .setDescription("Text channel for saved ticket transcripts.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName("panel_channel")
          .setDescription("Default channel for the ticket panel.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("name_format")
          .setDescription("Channel name pattern; supports {username}, {user}, {type}, {number}.")
          .setMaxLength(100)
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName("max_open_tickets")
          .setDescription("Maximum open tickets per member (1-25).")
          .setMinValue(1)
          .setMaxValue(25)
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName("cooldown_seconds")
          .setDescription("Seconds a member must wait after opening a ticket (0-86400).")
          .setMinValue(0)
          .setMaxValue(86400)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("panel")
      .setDescription("Post or refresh the configured ticket panel.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Panel channel; defaults to the configured channel.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("config")
      .setDescription("Change one setting without resetting other server settings.")
      .addStringOption((option) =>
        option
          .setName("setting")
          .setDescription("Setting to change.")
          .addChoices(
            ...settingChoices.map(([value, name]) => ({ name, value })),
          )
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("value")
          .setDescription("New value. Use an empty value only where allowed.")
          .setMaxLength(1000)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("config-staff-add")
      .setDescription("Give another role staff access to every ticket.")
      .addRoleOption((option) =>
        option.setName("role").setDescription("Staff role.").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("config-staff-remove")
      .setDescription("Remove a role from ticket staff access.")
      .addRoleOption((option) =>
        option.setName("role").setDescription("Staff role.").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("type-add")
      .setDescription("Add a ticket type and its button.")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Short unique ID, such as bug-report.")
          .setMinLength(2)
          .setMaxLength(24)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("label")
          .setDescription("Button label.")
          .setMaxLength(80)
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("Category for this ticket type.")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true),
      )
      .addRoleOption((option) =>
        option
          .setName("support_role")
          .setDescription("Primary support role for this ticket type.")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("emoji")
          .setDescription("Unicode emoji or a custom emoji ID.")
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName("style")
          .setDescription("Button style.")
          .addChoices(
            { name: "Primary", value: "primary" },
            { name: "Secondary", value: "secondary" },
            { name: "Success", value: "success" },
            { name: "Danger", value: "danger" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("welcome")
          .setDescription("Optional welcome message; overrides the default.")
          .setMaxLength(1500),
      )
      .addStringOption((option) =>
        option
          .setName("color")
          .setDescription("Optional ticket embed color as a hex value.")
          .setMaxLength(7),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("type-edit")
      .setDescription("Update one ticket type without changing the others.")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Existing ticket type ID.")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("label")
          .setDescription("Button label.")
          .setMaxLength(80),
      )
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("Category for this ticket type.")
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addRoleOption((option) =>
        option
          .setName("support_role")
          .setDescription("Primary support role for this ticket type."),
      )
      .addStringOption((option) =>
        option
          .setName("emoji")
          .setDescription("Unicode emoji or a custom emoji ID.")
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName("style")
          .setDescription("Button style.")
          .addChoices(
            { name: "Primary", value: "primary" },
            { name: "Secondary", value: "secondary" },
            { name: "Success", value: "success" },
            { name: "Danger", value: "danger" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("welcome")
          .setDescription("Welcome message.")
          .setMaxLength(1500),
      )
      .addStringOption((option) =>
        option
          .setName("color")
          .setDescription("Ticket embed color as a hex value.")
          .setMaxLength(7),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("type-remove")
      .setDescription("Remove a ticket type from new panels.")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Ticket type ID.")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("type-list").setDescription("List configured ticket types."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Open a ticket without using the panel.")
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Ticket type ID; defaults to the first configured type.")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("open")
      .setDescription("Open a ticket without using the panel.")
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Ticket type ID; defaults to the first configured type.")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("close")
      .setDescription("Request confirmation to close the current ticket.")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Optional reason recorded in the ticket log.")
          .setMaxLength(500)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("reopen")
      .setDescription("Reopen a closed ticket.")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Optional reason recorded in the ticket log.")
          .setMaxLength(500)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("delete")
      .setDescription("Request confirmation to transcript and delete a ticket.")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Optional deletion reason.")
          .setMaxLength(500)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("claim").setDescription("Claim this ticket as staff."),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("unclaim").setDescription("Release your claim on this ticket."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Give a server member access to this ticket.")
      .addUserOption((option) =>
        option
          .setName("member")
          .setDescription("Member to add.")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a member's direct access to this ticket.")
      .addUserOption((option) =>
        option
          .setName("member")
          .setDescription("Member to remove.")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("transcript")
      .setDescription("Save and send a transcript of the current ticket."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("rename")
      .setDescription("Rename the current ticket channel.")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("New channel name.")
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("info").setDescription("Show information about this ticket."),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("stats").setDescription("Show ticket counts for this server."),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("lock").setDescription("Lock the current ticket from member messages."),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("unlock").setDescription("Unlock a locked ticket."),
  );

function resolveEmoji(
  guild: Guild,
  configuredEmoji: string,
  fallback: string,
): string | { id: string; name: string; animated: boolean } {
  const customMatch = configuredEmoji.match(/^(?:<a?:[\w~]+:(\d+)>|(\d+))$/);
  const customId = customMatch?.[1] ?? customMatch?.[2];
  if (customId) {
    const emoji = guild.emojis.cache.get(customId);
    return emoji
      ? { id: emoji.id, name: emoji.name ?? fallback, animated: emoji.animated }
      : fallback;
  }

  return configuredEmoji || fallback;
}

export function createTicketPanelRows(
  guild: Guild,
  config: TicketConfig,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = config.ticketTypes.slice(0, 25).map((ticketType) => {
    const button = new ButtonBuilder()
      .setCustomId(`${CREATE_TICKET_BUTTON_PREFIX}${ticketType.id}`)
      .setLabel(ticketType.label.slice(0, 80))
      .setStyle(buttonStyles[ticketType.buttonStyle] ?? ButtonStyle.Primary);
    try {
      button.setEmoji(resolveEmoji(guild, ticketType.emoji, "🎫"));
    } catch {
      button.setEmoji("🎫");
    }
    return button;
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...buttons.slice(index, index + 5),
      ),
    );
  }
  return rows;
}

function makeControlButton(
  id: string,
  label: string,
  style: ButtonStyle,
  emoji: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setEmoji(emoji);
}

export function createTicketControlRows(
  status: "open" | "closed",
  claimedBy?: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons =
    status === "open"
      ? [
          makeControlButton(
            CLOSE_TICKET_BUTTON_ID,
            "Close",
            ButtonStyle.Danger,
            "🔒",
          ),
          makeControlButton(
            CLAIM_TICKET_BUTTON_ID,
            claimedBy ? `Claimed by ${claimedBy}`.slice(0, 80) : "Claim",
            ButtonStyle.Primary,
            "📋",
          ),
          makeControlButton(
            UNCLAIM_TICKET_BUTTON_ID,
            "Unclaim",
            ButtonStyle.Secondary,
            "↩️",
          ),
          makeControlButton(
            DELETE_TICKET_BUTTON_ID,
            "Delete",
            ButtonStyle.Danger,
            "🗑️",
          ),
          makeControlButton(
            TRANSCRIPT_TICKET_BUTTON_ID,
            "Transcript",
            ButtonStyle.Secondary,
            "📄",
          ),
          makeControlButton(
            ADD_TICKET_MEMBER_BUTTON_ID,
            "Add user",
            ButtonStyle.Secondary,
            "👤",
          ),
          makeControlButton(
            REMOVE_TICKET_MEMBER_BUTTON_ID,
            "Remove user",
            ButtonStyle.Secondary,
            "🚫",
          ),
          makeControlButton(
            LOCK_TICKET_BUTTON_ID,
            "Lock",
            ButtonStyle.Secondary,
            "🔐",
          ),
          makeControlButton(
            UNLOCK_TICKET_BUTTON_ID,
            "Unlock",
            ButtonStyle.Secondary,
            "🔓",
          ),
        ]
      : [
          makeControlButton(
            REOPEN_TICKET_BUTTON_ID,
            "Reopen",
            ButtonStyle.Success,
            "🔓",
          ),
          makeControlButton(
            DELETE_TICKET_BUTTON_ID,
            "Delete",
            ButtonStyle.Danger,
            "🗑️",
          ),
          makeControlButton(
            TRANSCRIPT_TICKET_BUTTON_ID,
            "Transcript",
            ButtonStyle.Secondary,
            "📄",
          ),
        ];

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...buttons.slice(index, index + 5),
      ),
    );
  }
  return rows;
}

export function createConfirmActionRow(
  action: "close" | "delete",
  requestId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_ACTION_PREFIX}${action}:${requestId}`)
      .setLabel(action === "close" ? "Confirm close" : "Confirm delete")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_ACTION_PREFIX}${action}:${requestId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function createCloseReasonModal(channelId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${CLOSE_REASON_MODAL_ID}:${channelId}`)
    .setTitle("Close ticket")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Optional close reason")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );
}

export function createMemberModal(action: "add" | "remove"): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${MEMBER_MODAL_PREFIX}${action}`)
    .setTitle(action === "add" ? "Add ticket member" : "Remove ticket member")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("member_id")
          .setLabel("Discord member ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(20),
      ),
    );
}