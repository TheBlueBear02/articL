import { READY_AUDIENCES, type Audience } from "@/lib/jobs";

/** The audience sent with a new job: one that can be made today, or "social" when not given. */
export function parseAudience(raw: unknown): { audience: Audience } | { error: string } {
  if (raw == null || raw === "") return { audience: "social" };
  if (!READY_AUDIENCES.includes(raw as Audience)) {
    return { error: `audience must be one of: ${READY_AUDIENCES.join(", ")}.` };
  }
  return { audience: raw as Audience };
}

/**
 * Insert payload extras for the audience. Social is the column's default, so it isn't written:
 * Social jobs keep working on a database before migration 0008.
 */
export const audienceColumn = (audience: Audience) => (audience === "social" ? {} : { audience });
