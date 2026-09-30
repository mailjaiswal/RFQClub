import BoardClient from "@/components/BoardClient";
import { getBoard } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  let initial;
  try {
    initial = await getBoard({ sort: "deadline" });
  } catch {
    initial = { count: 0, open_total: 0, demand_total: 0, demand_total_display: "—", items: [] };
  }
  return <BoardClient initial={initial} />;
}
