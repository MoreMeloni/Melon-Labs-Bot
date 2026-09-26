export type TicketMetadata = {
  ownerId: string;
  status: "open" | "closed";
  createdAt: number;
  typeId: string;
  supportRoleIds: string[];
  claimedBy?: string;
  locked?: boolean;
  closedAt?: number;
  closedBy?: string;
  deleteAt?: number;
  transcriptPath?: string;
};

export function serializeTicketMetadata(metadata: TicketMetadata): string {
  return `ticket-v2:${Buffer.from(JSON.stringify(metadata)).toString("base64url")}`;
}

export function parseTicketMetadata(
  topic: string | null,
): TicketMetadata | undefined {
  if (!topic) return undefined;

  if (topic.startsWith("ticket-v2:")) {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(topic.slice("ticket-v2:".length), "base64url").toString("utf8"),
      );
      if (!parsed || typeof parsed !== "object") return undefined;
      const data = parsed as Record<string, unknown>;
      if (
        typeof data.ownerId !== "string" ||
        (data.status !== "open" && data.status !== "closed") ||
        typeof data.createdAt !== "number" ||
        typeof data.typeId !== "string" ||
        !Array.isArray(data.supportRoleIds)
      ) {
        return undefined;
      }

      return {
        ownerId: data.ownerId,
        status: data.status,
        createdAt: data.createdAt,
        typeId: data.typeId,
        supportRoleIds: data.supportRoleIds.filter(
          (roleId): roleId is string => typeof roleId === "string",
        ),
        ...(typeof data.claimedBy === "string"
          ? { claimedBy: data.claimedBy }
          : {}),
        ...(typeof data.locked === "boolean" ? { locked: data.locked } : {}),
        ...(typeof data.closedAt === "number" ? { closedAt: data.closedAt } : {}),
        ...(typeof data.closedBy === "string" ? { closedBy: data.closedBy } : {}),
        ...(typeof data.deleteAt === "number" ? { deleteAt: data.deleteAt } : {}),
        ...(typeof data.transcriptPath === "string"
          ? { transcriptPath: data.transcriptPath }
          : {}),
      };
    } catch {
      return undefined;
    }
  }

  const legacy = topic.match(
    /^ticket-owner=(\d+);ticket-status=(open|closed);ticket-created=(\d+)$/,
  );
  if (!legacy) return undefined;

  return {
    ownerId: legacy[1],
    status: legacy[2] as TicketMetadata["status"],
    createdAt: Number(legacy[3]),
    typeId: "support",
    supportRoleIds: [],
  };
}

export function renderTicketText(
  template: string,
  values: {
    userId: string;
    username: string;
    type: string;
    number: number;
    closer?: string;
  },
): string {
  return template
    .replaceAll("{user}", `<@${values.userId}>`)
    .replaceAll("{username}", values.username)
    .replaceAll("{userid}", values.userId)
    .replaceAll("{type}", values.type)
    .replaceAll("{number}", String(values.number))
    .replaceAll("{closer}", values.closer ?? "the support team");
}

export function sanitizeChannelName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 95) || "ticket"
  );
}