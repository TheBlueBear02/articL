/**
 * Read an API response. Throws a readable error for failures, including ones whose body isn't
 * JSON (e.g. a server crash returns an empty 500), instead of "Unexpected end of JSON input".
 */
export async function readJson(res: Response) {
  const raw = await res.text();
  let body: { error?: string } & Record<string, unknown> = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // Not JSON: fall through and report the status below.
  }
  if (!res.ok) throw new Error(body.error ?? `Server error (${res.status}). Check the dev server's terminal for details.`);
  return body;
}
