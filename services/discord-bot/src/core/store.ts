import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type GuildLanguage = "en" | "de";
export type PermissionGroup =
  | "moderation"
  | "tickets"
  | "giveaways"
  | "applications"
  | "logging"
  | "economy"
  | "ai"
  | "music"
  | "voice"
  | "configuration";

export type GuildConfig = {
  guildId: string;
  language: GuildLanguage;
  botName: string;
  embedColor: string;
  footerText: string;
  aiPersonality: string;
  channels: {
    log?: string;
    moderationLog?: string;
    memberLog?: string;
    messageLog?: string;
    welcome?: string;
    leave?: string;
    verification?: string;
    applicationCategory?: string;
    giveaway?: string;
    suggestion?: string;
    report?: string;
    starboard?: string;
    level?: string;
    ai?: string;
  };
  roles: {
    staff: string[];
    moderators: string[];
    admins: string[];
    autoRole?: string;
  };
  commandRoles: Partial<Record<PermissionGroup, string[]>>;
  updatedAt: number;
};

type ConfigStore = Record<string, GuildConfig>;

const storePath = resolve(
  process.env.BOT_CONFIG_PATH ?? "data/guild-config.json",
);
let configs: ConfigStore = {};
let loaded = false;
let loadPromise: Promise<void> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeConfig(guildId: string, value: unknown): GuildConfig {
  const record = isRecord(value) ? value : {};
  const channelsRecord = isRecord(record.channels) ? record.channels : {};
  const rolesRecord = isRecord(record.roles) ? record.roles : {};
  const commandRolesRecord = isRecord(record.commandRoles)
    ? record.commandRoles
    : {};
  const language = record.language === "de" ? "de" : "en";

  const channels: GuildConfig["channels"] = {};
  for (const key of [
    "log",
    "moderationLog",
    "memberLog",
    "messageLog",
    "welcome",
    "leave",
    "verification",
    "applicationCategory",
    "giveaway",
    "suggestion",
    "report",
    "starboard",
    "level",
    "ai",
  ] as const) {
    const channelId = channelsRecord[key];
    if (typeof channelId === "string" && channelId.length > 0) {
      channels[key] = channelId;
    }
  }

  const commandRoles: GuildConfig["commandRoles"] = {};
  for (const key of [
    "moderation",
    "tickets",
    "giveaways",
    "applications",
    "logging",
    "economy",
    "ai",
    "music",
    "voice",
    "configuration",
  ] as const) {
    const roleIds = stringArray(commandRolesRecord[key]);
    if (roleIds.length > 0) commandRoles[key] = [...new Set(roleIds)];
  }

  return {
    guildId,
    language,
    botName: stringOr(record.botName, "Melon Labs"),
    embedColor: stringOr(record.embedColor, "#5865F2"),
    footerText: stringOr(record.footerText, "Melon Labs"),
    aiPersonality: stringOr(
      record.aiPersonality,
      "Helpful, concise, and respectful.",
    ),
    channels,
    roles: {
      staff: stringArray(rolesRecord.staff),
      moderators: stringArray(rolesRecord.moderators),
      admins: stringArray(rolesRecord.admins),
      ...(typeof rolesRecord.autoRole === "string"
        ? { autoRole: rolesRecord.autoRole }
        : {}),
    },
    commandRoles,
    updatedAt:
      typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
  };
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

async function loadStore(): Promise<void> {
  if (loaded) return;
  loadPromise ??= (async () => {
    try {
      const contents = await readFile(storePath, "utf8");
      const parsed: unknown = JSON.parse(contents);
      if (!isRecord(parsed)) throw new Error("Guild config must be an object.");
      const normalized: ConfigStore = {};
      for (const [guildId, value] of Object.entries(parsed)) {
        normalized[guildId] = normalizeConfig(guildId, value);
      }
      configs = normalized;
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        throw new Error(`Could not load guild configuration from ${storePath}.`, {
          cause: error,
        });
      }
      configs = {};
    }
    loaded = true;
  })();
  await loadPromise;
}

export function createGuildConfig(guildId: string): GuildConfig {
  return {
    guildId,
    language: "en",
    botName: "Melon Labs",
    embedColor: "#5865F2",
    footerText: "Melon Labs",
    aiPersonality: "Helpful, concise, and respectful.",
    channels: {},
    roles: { staff: [], moderators: [], admins: [] },
    commandRoles: {},
    updatedAt: Date.now(),
  };
}

export async function getGuildConfig(
  guildId: string,
): Promise<GuildConfig | undefined> {
  await writeQueue;
  await loadStore();
  return configs[guildId];
}

export async function ensureGuildConfig(guildId: string): Promise<GuildConfig> {
  const current = await getGuildConfig(guildId);
  if (current) return current;
  const config = createGuildConfig(guildId);
  await saveGuildConfig(guildId, config);
  return config;
}

export function saveGuildConfig(
  guildId: string,
  config: GuildConfig,
): Promise<void> {
  const operation = writeQueue.then(async () => {
    await loadStore();
    await persist({
      ...configs,
      [guildId]: { ...config, guildId, updatedAt: Date.now() },
    });
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function updateGuildConfig(
  guildId: string,
  update: Partial<Omit<GuildConfig, "guildId" | "updatedAt">>,
): Promise<GuildConfig> {
  let saved: GuildConfig;
  const operation = writeQueue.then(async () => {
    await loadStore();
    const current = configs[guildId] ?? createGuildConfig(guildId);
    saved = {
      ...current,
      ...update,
      channels: { ...current.channels, ...(update.channels ?? {}) },
      roles: { ...current.roles, ...(update.roles ?? {}) },
      commandRoles: {
        ...current.commandRoles,
        ...(update.commandRoles ?? {}),
      },
      guildId,
      updatedAt: Date.now(),
    };
    await persist({ ...configs, [guildId]: saved });
  });
  writeQueue = operation.catch(() => undefined);
  return operation.then(() => saved);
}

export async function resetGuildConfig(guildId: string): Promise<GuildConfig> {
  const config = createGuildConfig(guildId);
  await saveGuildConfig(guildId, config);
  return config;
}

export async function listGuildConfigs(): Promise<GuildConfig[]> {
  await writeQueue;
  await loadStore();
  return Object.values(configs);
}