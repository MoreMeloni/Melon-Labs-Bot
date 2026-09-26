import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type TicketButtonStyle = "primary" | "secondary" | "success" | "danger";

export type TicketTypeConfig = {
  id: string;
  label: string;
  emoji: string;
  buttonStyle: TicketButtonStyle;
  categoryId: string;
  supportRoleIds: string[];
  welcomeMessage: string;
  color?: string;
};

export type TicketConfig = {
  categoryId: string;
  supportRoleId: string;
  logChannelId: string;
  transcriptChannelId: string;
  panelChannelId?: string;
  nameFormat: string;
  maxOpenTickets: number;
  cooldownSeconds: number;
  deleteAfterSeconds: number;
  staffRoleIds: string[];
  embedColor: string;
  panelTitle: string;
  panelDescription: string;
  panelImageUrl?: string;
  panelThumbnailUrl?: string;
  footerText: string;
  buttonLabel: string;
  buttonEmoji: string;
  buttonStyle: TicketButtonStyle;
  welcomeMessage: string;
  closingMessage: string;
  ticketTypes: TicketTypeConfig[];
  lastOpenedAt: Record<string, number>;
};

type ConfigStore = Record<string, TicketConfig>;

const storePath = resolve(
  process.env.TICKET_CONFIG_PATH ?? "data/ticket-config.json",
);

let configs: ConfigStore = {};
let loaded = false;
let loadPromise: Promise<void> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

const validStyles: TicketButtonStyle[] = [
  "primary",
  "secondary",
  "success",
  "danger",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function validButtonStyle(value: unknown): TicketButtonStyle {
  return validStyles.includes(value as TicketButtonStyle)
    ? (value as TicketButtonStyle)
    : "primary";
}

function createDefaultTicketType(
  categoryId: string,
  supportRoleId: string,
): TicketTypeConfig {
  return {
    id: "support",
    label: "Support",
    emoji: "🎫",
    buttonStyle: "primary",
    categoryId,
    supportRoleIds: [supportRoleId],
    welcomeMessage:
      "Welcome {user}. The {type} support team will help you here.",
  };
}

function normalizeTicketType(
  value: unknown,
  fallbackCategoryId: string,
  fallbackSupportRoleId: string,
): TicketTypeConfig | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;

  const supportRoleIds = Array.isArray(value.supportRoleIds)
    ? value.supportRoleIds.filter(
        (roleId): roleId is string => typeof roleId === "string",
      )
    : typeof value.supportRoleId === "string"
      ? [value.supportRoleId]
      : [fallbackSupportRoleId];

  return {
    id: value.id,
    label: stringOr(value.label, value.id),
    emoji: stringOr(value.emoji, "🎫"),
    buttonStyle: validButtonStyle(value.buttonStyle),
    categoryId: stringOr(value.categoryId, fallbackCategoryId),
    supportRoleIds,
    welcomeMessage: stringOr(
      value.welcomeMessage,
      "Welcome {user}. The {type} support team will help you here.",
    ),
    ...(typeof value.color === "string" ? { color: value.color } : {}),
  };
}

function normalizeConfig(value: unknown): TicketConfig | undefined {
  if (
    !isRecord(value) ||
    typeof value.categoryId !== "string" ||
    typeof value.supportRoleId !== "string" ||
    typeof value.logChannelId !== "string"
  ) {
    return undefined;
  }

  const types = Array.isArray(value.ticketTypes)
    ? value.ticketTypes
        .map((ticketType) =>
          normalizeTicketType(
            ticketType,
            value.categoryId as string,
            value.supportRoleId as string,
          ),
        )
        .filter((ticketType): ticketType is TicketTypeConfig => !!ticketType)
    : [];
  const ticketTypes =
    types.length > 0
      ? types
      : [createDefaultTicketType(value.categoryId, value.supportRoleId)];

  const openedAt: Record<string, number> = {};
  if (isRecord(value.lastOpenedAt)) {
    for (const [userId, timestamp] of Object.entries(value.lastOpenedAt)) {
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        openedAt[userId] = timestamp;
      }
    }
  }

  const legacyOnly =
    !Array.isArray(value.ticketTypes) &&
    Object.keys(value).every((key) =>
      ["categoryId", "supportRoleId", "logChannelId"].includes(key),
    );
  return {
    categoryId: value.categoryId,
    supportRoleId: value.supportRoleId,
    logChannelId: value.logChannelId,
    transcriptChannelId: stringOr(
      value.transcriptChannelId,
      value.logChannelId,
    ),
    ...(typeof value.panelChannelId === "string"
      ? { panelChannelId: value.panelChannelId }
      : {}),
    nameFormat: stringOr(value.nameFormat, "ticket-{username}-{number}"),
    maxOpenTickets: Math.max(
      1,
      Math.min(25, Math.floor(numberOr(value.maxOpenTickets, 1))),
    ),
    cooldownSeconds: Math.max(
      0,
      Math.min(86400, Math.floor(numberOr(value.cooldownSeconds, 0))),
    ),
    deleteAfterSeconds: Math.max(
      0,
      Math.min(2147000, Math.floor(numberOr(value.deleteAfterSeconds, 0))),
    ),
    staffRoleIds: Array.isArray(value.staffRoleIds)
      ? value.staffRoleIds.filter(
          (roleId): roleId is string => typeof roleId === "string",
        )
      : [value.supportRoleId],
    embedColor: stringOr(value.embedColor, "#5865F2"),
    panelTitle: stringOr(value.panelTitle, "Need help?"),
    panelDescription: stringOr(
      value.panelDescription,
      "Choose a ticket type below to open a private support channel.",
    ),
    ...(typeof value.panelImageUrl === "string"
      ? { panelImageUrl: value.panelImageUrl }
      : {}),
    ...(typeof value.panelThumbnailUrl === "string"
      ? { panelThumbnailUrl: value.panelThumbnailUrl }
      : {}),
    footerText: stringOr(value.footerText, "Support desk"),
    buttonLabel: stringOr(value.buttonLabel, "Support"),
    buttonEmoji: stringOr(value.buttonEmoji, "🎫"),
    buttonStyle: validButtonStyle(value.buttonStyle),
    welcomeMessage: stringOr(
      value.welcomeMessage,
      "Welcome {user}. The {type} support team will help you here.",
    ),
    closingMessage: stringOr(
      value.closingMessage,
      "This ticket has been closed by {closer}.",
    ),
    ticketTypes: legacyOnly
      ? [createDefaultTicketType(value.categoryId, value.supportRoleId)]
      : ticketTypes,
    lastOpenedAt: openedAt,
  };
}

async function loadStore(): Promise<void> {
  if (loaded) return;

  loadPromise ??= (async () => {
    try {
      const contents = await readFile(storePath, "utf8");
      const parsed: unknown = JSON.parse(contents);
      if (!isRecord(parsed)) {
        throw new Error("Ticket configuration file must contain an object.");
      }

      const normalized: ConfigStore = {};
      for (const [guildId, config] of Object.entries(parsed)) {
        const ticketConfig = normalizeConfig(config);
        if (!ticketConfig) {
          throw new Error(`Ticket configuration for server ${guildId} is invalid.`);
        }
        normalized[guildId] = ticketConfig;
      }
      configs = normalized;
      loaded = true;
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        try {
          await persist(normalized);
        } catch (error) {
          console.error(
            "Ticket settings were migrated in memory but could not be saved to disk:",
            error,
          );
        }
      }
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        configs = {};
      } else {
        throw new Error(`Could not load ticket settings from ${storePath}.`, {
          cause: error,
        });
      }
    }

    loaded = true;
  })();

  await loadPromise;
}

async function persist(updated: ConfigStore): Promise<void> {
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, storePath);
  configs = updated;
}

export async function getTicketConfig(
  guildId: string,
): Promise<TicketConfig | undefined> {
  await writeQueue;
  await loadStore();
  return configs[guildId];
}

export function saveTicketConfig(
  guildId: string,
  config: TicketConfig,
): Promise<void> {
  const operation = writeQueue.then(async () => {
    await loadStore();
    const updated: ConfigStore = { ...configs, [guildId]: config };
    await persist(updated);
  });

  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function updateTicketConfig(
  guildId: string,
  update: Partial<TicketConfig>,
): Promise<TicketConfig> {
  let savedConfig: TicketConfig;
  const operation = writeQueue.then(async () => {
    await loadStore();
    const current = configs[guildId];
    if (!current) throw new Error("Ticket settings have not been initialized.");
    savedConfig = { ...current, ...update };
    await persist({ ...configs, [guildId]: savedConfig });
  });

  writeQueue = operation.catch(() => undefined);
  return operation.then(() => savedConfig);
}

export function recordTicketOpened(
  guildId: string,
  userId: string,
  timestamp: number,
): Promise<TicketConfig> {
  let savedConfig: TicketConfig;
  const operation = writeQueue.then(async () => {
    await loadStore();
    const current = configs[guildId];
    if (!current) throw new Error("Ticket settings have not been initialized.");
    savedConfig = {
      ...current,
      lastOpenedAt: { ...current.lastOpenedAt, [userId]: timestamp },
    };
    await persist({ ...configs, [guildId]: savedConfig });
  });

  writeQueue = operation.catch(() => undefined);
  return operation.then(() => savedConfig);
}

export function createTicketConfig(
  categoryId: string,
  supportRoleId: string,
  logChannelId: string,
): TicketConfig {
  const defaultType = createDefaultTicketType(categoryId, supportRoleId);
  return {
    categoryId,
    supportRoleId,
    logChannelId,
    transcriptChannelId: logChannelId,
    nameFormat: "ticket-{username}-{number}",
    maxOpenTickets: 1,
    cooldownSeconds: 0,
    deleteAfterSeconds: 0,
    staffRoleIds: [supportRoleId],
    embedColor: "#5865F2",
    panelTitle: "Need help?",
    panelDescription:
      "Choose a ticket type below to open a private support channel.",
    footerText: "Support desk",
    buttonLabel: "Support",
    buttonEmoji: "🎫",
    buttonStyle: "primary",
    welcomeMessage:
      "Welcome {user}. The {type} support team will help you here.",
    closingMessage: "This ticket has been closed by {closer}.",
    ticketTypes: [defaultType],
    lastOpenedAt: {},
  };
}