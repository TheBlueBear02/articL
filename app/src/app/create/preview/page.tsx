import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PreviewSteps } from "./preview-steps";

// Dev-only: /create/preview?step=3 shows a step with sample data, to review the design without a
// real job. Not available in production builds.
export default function PreviewPage({ searchParams }: PageProps<"/create/preview">) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Step searchParams={searchParams} />
    </Suspense>
  );
}

async function Step({ searchParams }: { searchParams: PageProps<"/create/preview">["searchParams"] }) {
  const step = Number((await searchParams).step ?? 3);
  return <PreviewSteps step={Number.isInteger(step) ? step : 3} />;
}
