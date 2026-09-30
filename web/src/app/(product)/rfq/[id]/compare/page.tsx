import { notFound } from "next/navigation";
import { getBids } from "@/lib/api";
import CompareBids from "@/components/CompareBids";

export const dynamic = "force-dynamic";

export default async function CompareBidsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await getBids(id);
  } catch {
    notFound();
  }
  return <CompareBids data={data} />;
}
