import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  createdBy: string;
  createdAt: number;
};

export type Reminder = {
  id: string;
  guildId: string;
  userId: string;
  channelId: string;
  text: string;
  dueAt: number;
};

export type CommunityData = {
  guildId: string;
  rules: string;
  faq: FaqEntry[];
  reminders: Reminder[];
};

type Store = Record<string, CommunityData>;
const storePath = resolve(
  process.env.COMMUNITY_CONFIG_PATH ?? "data/community.json",
);
let data: Store = {};
let loaded = false;
let loadPromise: Promise<void> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function create(guildId: string): CommunityData {
  return { guildId, rules: "", faq: [], reminders: [] };
}

async function load(): Promise<void> {
  if (loaded) return;
  loadPromise ??= (async () => {
    try {
      const raw = await readFile(storePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Store;
      }
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        throw new Error(`Could not load community data from ${storePath}.`, {
          cause: error,
        });
      }
    }
    loaded = true;
  })();
  await loadPromise;
}

async function persist(next: Store): Promise<void> {
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, storePath);
  data = next;
}

export async function getCommunityData(guildId: string): Promise<CommunityData> {
  await writeQueue;
  await load();
  return data[guildId] ?? create(guildId);
}

export function updateCommunityData(
  guildId: string,
  update: Partial<CommunityData>,
): Promise<CommunityData> {
  let saved: CommunityData;
  const operation = writeQueue.then(async () => {
    await load();
    saved = { ...(data[guildId] ?? create(guildId)), ...update, guildId };
    await persist({ ...data, [guildId]: saved });
  });
  writeQueue = operation.catch(() => undefined);
  return operation.then(() => saved);
}

export function addReminder(reminder: Reminder): Promise<void> {
  const operation = writeQueue.then(async () => {
    await load();
    const current = data[reminder.guildId] ?? create(reminder.guildId);
    await persist({
      ...data,
      [reminder.guildId]: {
        ...current,
        reminders: [...current.reminders, reminder],
      },
    });
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function removeReminder(guildId: string, id: string): Promise<void> {
  const operation = writeQueue.then(async () => {
    await load();
    const current = data[guildId] ?? create(guildId);
    await persist({
      ...data,
      [guildId]: {
        ...current,
        reminders: current.reminders.filter((reminder) => reminder.id !== id),
      },
    });
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function listReminders(): Promise<Reminder[]> {
  await writeQueue;
  await load();
  return Object.values(data).flatMap((entry) => entry.reminders);
}