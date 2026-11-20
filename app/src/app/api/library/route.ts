import { connection } from "next/server";
import { libraryInfo } from "@/lib/library";

// What the add-ons library holds, so the points screen only offers choices that can be fulfilled.
export async function GET() {
  await connection(); // always read the live library, never a build-time snapshot
  try {
    return Response.json(await libraryInfo());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
