import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type TicketConfig = {
  categoryId: string;
  supportRoleId: string;
  logChannelId: string;
};

type ConfigStore = Record<string, TicketConfig>;

const storePath = resolve(
  process.env.TICKET_CONFIG_PATH ?? "data/ticket-config.json",
);

let configs: ConfigStore = {};
let loaded = false;
let loadPromise: Promise<void> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function isTicketConfig(value: unknown): value is TicketConfig {
  if (!value || typeof value !== "object") return false;

  const config = value as Record<string, unknown>;
  return (
    typeof config.categoryId === "string" &&
    typeof config.supportRoleId === "string" &&
    typeof config.logChannelId === "string"
  );
}

async function loadStore(): Promise<void> {
  if (loaded) return;

  loadPromise ??= (async () => {
    try {
      const contents = await readFile(storePath, "utf8");
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Ticket configuration file must contain an object.");
      }

      const entries = Object.entries(parsed);
      if (!entries.every(([, config]) => isTicketConfig(config))) {
        throw new Error("Ticket configuration file contains an invalid entry.");
      }

      configs = parsed as ConfigStore;
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
    const temporaryPath = `${storePath}.${process.pid}.tmp`;

    await mkdir(dirname(storePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, storePath);
    configs = updated;
  });

  writeQueue = operation.catch(() => undefined);
  return operation;
}