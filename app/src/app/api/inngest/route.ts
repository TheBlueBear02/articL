import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { extractArticle, proposeFindings, writeHooks } from "@/inngest/extract-article";
import { produceVoice } from "@/inngest/produce-voice";
import { renderVideo } from "@/inngest/render-video";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [extractArticle, proposeFindings, writeHooks, produceVoice, renderVideo],
});
