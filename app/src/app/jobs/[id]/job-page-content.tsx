"use client";

import { useParams } from "next/navigation";
import { JobView } from "@/components/job-view";

export function JobPageContent() {
  const { id } = useParams<{ id: string }>();
  // key: a fresh view (and selection state) when navigating between jobs.
  return <JobView key={id} jobId={id} />;
}
