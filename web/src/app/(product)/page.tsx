import BoardClient from "@/components/BoardClient";
import { getBoard } from "@/lib/api";

export const dynamic = "force-dynamic";

type View = "all" | "saved" | "myrfqs" | "mybids";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view = (["saved", "myrfqs", "mybids"].includes(sp.view || "") ? sp.view : "all") as View;

  let initial;
  try {
    initial = await getBoard({ sort: "deadline" });
  } catch {
    initial = { count: 0, open_total: 0, demand_total: 0, demand_total_display: "—", items: [] };
  }
  return <BoardClient initial={initial} view={view} />;
}
