"use client";
import { useEffect, useState } from "react";
import RfqCard from "@/components/RfqCard";
import { SECTOR_LIST, SectorGlyph } from "@/lib/sectors";
import { getBoard, type BoardResponse } from "@/lib/api";

type Sort = "deadline" | "value" | "bidcount";

export default function BoardClient({ initial }: { initial: BoardResponse }) {
  const [data, setData] = useState<BoardResponse>(initial);
  const [sector, setSector] = useState<string>("");
  const [sort, setSort] = useState<Sort>("deadline");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      getBoard({ sector: sector || undefined, q: q || undefined, sort })
        .then((d) => !cancelled && setData(d))
        .catch(() => {})
        .finally(() => !cancelled && setLoading(false));
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [sector, sort, q]);

  return (
    <>
      {/* hero */}
      <section className="mx-auto max-w-6xl px-4 pt-10 pb-6">
        <h1 className="display" style={{ fontSize: "clamp(26px,4vw,40px)", lineHeight: 1.08, letterSpacing: "-1px", fontWeight: 500, margin: 0 }}>
          Open manufacturing requirements,
          <br /> bid on <span style={{ color: "var(--primary)" }}>total landed cost</span>.
        </h1>
        <p className="subtle" style={{ fontSize: 14, maxWidth: 560, marginTop: 10 }}>
          Every RFQ is reviewed by a concierge before it reaches the board. Supplier bids
          stay blinded (Bid A–E) until the buyer picks a winner.
        </p>
        <div className="flex flex-wrap gap-8" style={{ marginTop: 18 }}>
          <Stat n={String(initial.open_total)} label="open RFQs" />
          <Stat n={initial.demand_total_display} label="live demand" />
          <Stat n={String(initial.items.length)} label="matching now" />
        </div>
      </section>

      {/* filters */}
      <section className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3" style={{ paddingBottom: 14 }}>
          <div className="flex flex-wrap gap-2" style={{ flex: 1 }}>
            <button className="pill" data-active={!sector} onClick={() => setSector("")}
              style={!sector ? { background: "var(--ink)", color: "#fff", borderColor: "transparent" } : undefined}>
              All sectors
            </button>
            {SECTOR_LIST.map((s) => (
              <button
                key={s.key}
                className="pill"
                data-active={sector === s.key}
                onClick={() => setSector(sector === s.key ? "" : s.key)}
                style={sector === s.key ? { background: s.base, color: "#fff", borderColor: "transparent" } : undefined}
              >
                <SectorGlyph sector={s.key} size={14} /> {s.label.split(" ")[0]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="field" style={{ width: 200 }} placeholder="Search title / material…"
              value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="field" style={{ width: 150 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="deadline">Deadline</option>
              <option value="value">Value</option>
              <option value="bidcount">Bid count</option>
            </select>
          </div>
        </div>
      </section>

      {/* grid */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        {loading && <div className="muted" style={{ padding: "6px 0 14px" }}>Loading…</div>}
        {data.items.length === 0 ? (
          <div className="surface-card" style={{ padding: 40, textAlign: "center" }}>
            <p className="muted">No open RFQs match these filters.</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
            {data.items.map((r) => (
              <RfqCard key={r.id} rfq={r} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-1px" }}>{n}</div>
      <div className="label-mono">{label}</div>
    </div>
  );
}
