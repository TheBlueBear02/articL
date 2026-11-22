// Default post text per platform, built from the checked script caption (no new AI call).
import type { AuthorInfo, PaperMeta, PostPlatform, Script } from "./jobs";

export const PLATFORM_LABEL: Record<PostPlatform, string> = { instagram: "Instagram", tiktok: "TikTok", linkedin: "LinkedIn" };

function splitCaption(caption: string): { body: string; tags: string } {
  const lines = caption.split("\n").map((l) => l.trim()).filter(Boolean);
  const tagLine = lines.findLast((l) => /^(#\w+\s*)+$/.test(l)) ?? "";
  return { body: lines.filter((l) => l !== tagLine).join("\n"), tags: tagLine };
}

/** "Research by Dana Levi, PhD student, Tel Aviv University". */
export function authorLine(author: AuthorInfo | null | undefined): string {
  const parts = [author?.name, author?.role, author?.university].map((s) => s?.trim()).filter(Boolean);
  return parts.length ? `Research by ${parts.join(", ")}` : "";
}

export function sourceLine(script: Script | null | undefined, meta: PaperMeta | null | undefined): string {
  const title = meta?.title ? `“${meta.title}”` : "";
  const credit = script?.sourceCredit ? ` (${script.sourceCredit})` : "";
  const link = meta?.doi ? ` https://doi.org/${meta.doi}` : "";
  return title || link ? `Paper: ${title}${credit}${link}`.trim() : "";
}

export function defaultPostText(
  platform: PostPlatform,
  script: Script | null | undefined,
  author: AuthorInfo | null | undefined,
  meta: PaperMeta | null | undefined,
): string {
  const { body, tags } = splitCaption(script?.postCaption ?? "");
  const by = authorLine(author);
  const source = sourceLine(script, meta);
  if (platform === "tiktok") {
    // Short: the caption, who did it, the tags.
    return [body, by, tags].filter(Boolean).join("\n\n");
  }
  if (platform === "linkedin") {
    // Professional: the hook title as an opening line, who did it and the paper link, fewer tags.
    const title = script?.hookTitle ? `${script.hookTitle}.` : "";
    const fewTags = tags.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
    return [title, body, [by, source].filter(Boolean).join("\n"), fewTags].filter(Boolean).join("\n\n");
  }
  return [body, [by, source].filter(Boolean).join("\n"), tags].filter(Boolean).join("\n\n");
}
