import type { Viewport } from "next";
import { CreateStart } from "@/components/create/create-start";

export const viewport: Viewport = { themeColor: "#ffffff", viewportFit: "cover" };

// The new mobile create flow, steps 1-2: pick the paper, then who it is for (the upload runs in the
// background). The other steps live at /create/<id>.
export default function CreatePage() {
  return <CreateStart />;
}
