import { inngest } from "./client";

/**
 * Send an Inngest event, turning a failure into a readable message. The usual local cause is
 * the Inngest dev server not running (`npm run inngest`), which otherwise surfaces as a bare 500.
 */
export async function sendJobEvent(name: string, data: Record<string, unknown>): Promise<string | null> {
  try {
    await inngest.send({ name, data });
    return null;
  } catch (e) {
    console.error(`Sending ${name} failed:`, e);
    return process.env.INNGEST_DEV
      ? "The background job runner isn't reachable. Start it with `npm run inngest` in the app folder, then try again."
      : "Couldn't start the background job. Please try again.";
  }
}
