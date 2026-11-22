import "server-only";
import { chatJson, type Usage } from "./openai";
import { normalize } from "./points";
import type { PaperMeta } from "./jobs";

/** First lines of the paper: title and authors are printed here. */
const FRONT_CHARS = 2500;

const SYSTEM = `You read the first page of a research paper and return its title and authors.
- title: the paper's own title, copied exactly as printed (not the journal or a running header).
- authors: each author's full name as printed, in order (no affiliations, degrees or footnote marks).
- year: the publication year if printed on this page, else "".
If you can't tell, use "" or [].`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "authors", "year"],
  properties: {
    title: { type: "string" },
    authors: { type: "array", items: { type: "string" } },
    year: { type: "string" },
  },
};

/** "10.1257/aer.20181234" from the front matter, if the paper prints a DOI. */
export function findDoi(text: string): string | undefined {
  const m = text.slice(0, 6000).match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  return m?.[1].replace(/[.,;)\]]+$/, "");
}

/**
 * Title, authors and year from the first page. Each value is kept only if it is found in the text,
 * so a wrong guess is dropped rather than shown on the "Reading your paper" card.
 */
export async function readPaperMeta(text: string): Promise<{ meta: PaperMeta; usage: Usage; model: string }> {
  const front = text.slice(0, FRONT_CHARS);
  const { data, usage, model } = await chatJson<{ title: string; authors: string[]; year: string }>({
    system: SYSTEM,
    user: front,
    schemaName: "paper_meta",
    schema: SCHEMA,
  });
  const inFront = (s: string) => s.trim().length > 1 && normalize(front).includes(normalize(s));
  const meta: PaperMeta = {
    title: inFront(data.title) ? data.title.trim().replace(/\s+/g, " ") : undefined,
    authors: data.authors.map((a) => a.trim()).filter(inFront).slice(0, 8),
    year: /^(19|20)\d{2}$/.test(data.year) && front.includes(data.year) ? data.year : undefined,
    doi: findDoi(text),
  };
  return { meta, usage, model };
}
