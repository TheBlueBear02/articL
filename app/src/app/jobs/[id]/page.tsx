import { Suspense } from "react";
import { JobPageContent } from "./job-page-content";

// One job's page, e.g. /jobs/9e123bad-…: survives a refresh and can be bookmarked or shared.
// The id is only known at request time, so with Cache Components the part that reads it
// (useParams) needs a Suspense boundary.
export default function JobPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <JobPageContent />
      </Suspense>
    </main>
  );
}
