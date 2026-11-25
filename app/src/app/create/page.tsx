import type { Viewport } from "next";
import { CreateStart } from "@/components/create/create-start";

export const viewport: Viewport = { themeColor: "#ffffff", viewportFit: "cover" };

// Create flow steps 1–2: pick the paper, then who it is for. Later steps live at /create/<id>.
export default function CreatePage() {
  return <CreateStart />;
}
