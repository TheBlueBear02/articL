import { Suspense } from "react";
import type { Viewport } from "next";
import { CreateFlowPage } from "./create-flow-page";

export const viewport: Viewport = { themeColor: "#ffffff", viewportFit: "cover" };

// Steps 2-8 for one video. The id is only known at request time, so the part that reads it
// (useParams) sits inside a Suspense boundary (Cache Components).
export default function CreateJobPage() {
  return (
    <Suspense fallback={<div className="a2r min-h-dvh" />}>
      <CreateFlowPage />
    </Suspense>
  );
}
