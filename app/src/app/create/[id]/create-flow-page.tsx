"use client";

import { useParams } from "next/navigation";
import { CreateFlow } from "@/components/create/create-flow";

export function CreateFlowPage() {
  const { id } = useParams<{ id: string }>();
  return <CreateFlow key={id} jobId={id} />;
}
