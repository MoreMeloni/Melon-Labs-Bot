import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type Warning = {
  id: string;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: number;
};

type WarningStore = Record<string, Warning[]>;

const storePath = resolve(
  process.env.MODERATION_CONFIG_PATH ?? "data/moderation.json",
);
let store: WarningStore = {};
let loaded = false;
let loadPromise: Promise<void> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<void> {
  if (loaded) return;
  loadPromise ??= (async () => {
    try {
      const raw = await readFile(storePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        store = parsed as WarningStore;
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
        throw new Error(`Could not load moderation data from ${storePath}.`, {
          cause: error,
        });
      }
    }
    loaded = true;
  })();
  await loadPromise;
}

async function persist(next: WarningStore): Promise<void> {
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, storePath);
  store = next;
}

export async function getWarnings(
  guildId: string,
  userId: string,
): Promise<Warning[]> {
  await writeQueue;
  await load();
  return [...(store[`${guildId}:${userId}`] ?? [])].sort(
    (left, right) => right.createdAt - left.createdAt,
  );
}

export function addWarning(
  warning: Omit<Warning, "id" | "createdAt">,
): Promise<Warning> {
  const created: Warning = {
    ...warning,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  const operation = writeQueue.then(async () => {
    await load();
    const key = `${warning.guildId}:${warning.userId}`;
    await persist({ ...store, [key]: [...(store[key] ?? []), created] });
  });
  writeQueue = operation.catch(() => undefined);
  return operation.then(() => created);
}

export function removeWarning(guildId: string, userId: string, id: string): Promise<boolean> {
  let removed = false;
  const operation = writeQueue.then(async () => {
    await load();
    const key = `${guildId}:${userId}`;
    const current = store[key] ?? [];
    const next = current.filter((warning) => warning.id !== id);
    removed = next.length !== current.length;
    if (removed) await persist({ ...store, [key]: next });
  });
  writeQueue = operation.catch(() => undefined);
  return operation.then(() => removed);
}