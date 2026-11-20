import { Suspense } from "react";
import Link from "next/link";
import { JobPageContent } from "./job-page-content";

// One job's page, e.g. /jobs/9e123bad-…: survives a refresh and can be bookmarked or shared.
// The id is only known at request time, so with Cache Components the part that reads it
// (useParams) needs a Suspense boundary.
export default function JobPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <Link href="/" className="text-sm text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-400">
        ← New video · My videos
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">ArticL</h1>
      <Suspense fallback={<p className="mt-8 text-sm text-neutral-500">Loading…</p>}>
        <JobPageContent />
      </Suspense>
    </main>
  );
}
