"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useConsole } from "@/components/console/ConsoleApp";
import { StatusPill, fmtDate, relTime, KIND_ICON } from "@/components/console/ui";
import { useCached } from "@/lib/cache";
import {
  addActivity, addTask, assignLeads, completeTask, detailKey, getLead, markQueuesStale,
  mutateDetail, patchDetail, patchRows, peekRow, setNextStep, setStatus,
  type Activity, type Contact, type LeadDetail, type Task,
} from "@/lib/sales-api";

// statuses that end the pipeline (declined / dead / on-hold) — rendered apart from
// the forward stepper so a rep can park or kill a lead in one click.
const DEAD_ENDS = [
  { key: "not_interested", label: "Declined", cls: "bad" },
  { key: "nurture", label: "On hold", cls: "" },
  { key: "incorrect", label: "Dead / wrong", cls: "bad" },
];

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { meta, isManager, user } = useConsole();
  const id = Number(params?.id);

  // A hovered queue row has usually prefetched this record already, so the click
  // paints the whole page with no wait. A cold deep link falls back to the queue
  // row snapshot for the header while the payload streams in.
  const { data: d, error: apiErr, revalidate } = useCached<LeadDetail>(
    detailKey(id), () => getLead(id), { enabled: !!id },
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * Send a write whose outcome the caller has already painted into the cache.
   * Nothing here gates the UI on the response, so the user can navigate away the
   * instant they click; the queues are flagged stale so wherever they land next
   * shows fresh data behind an instant cached paint.
   */
  async function run(fn: () => Promise<unknown>) {
    setErr(""); setBusy(true); markQueuesStale();
    try { await fn(); }
    catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
    revalidate();
  }

  const me = (user?.email || "").toLowerCase();
  const labelFor = (key: string) =>
    (meta?.statuses || []).find((s) => s.key === key)?.label || key;

  function changeStatus(key: string) {
    const label = labelFor(key);
    patchDetail(id, { status: key, status_label: label });
    patchRows(id, { status: key, status_label: label });
    run(() => setStatus(id, key));
  }
  function saveNextStep(b: { next_action_at: string | null; next_action_note: string }) {
    patchDetail(id, b); patchRows(id, b);
    run(() => setNextStep(id, b));
  }
  function claimSelf() {
    patchDetail(id, { owner_email: me }); patchRows(id, { owner_email: me });
    run(() => assignLeads([id]));
  }
  function releaseToPool() {
    patchDetail(id, { owner_email: "" }); patchRows(id, { owner_email: "" });
    run(() => assignLeads([id], ""));
  }
  function reassign(email: string) {
    patchDetail(id, { owner_email: email }); patchRows(id, { owner_email: email });
    run(() => assignLeads([id], email));
  }

  /** A touchpoint shows up in the timeline immediately from what was typed; the
   *  revalidate swaps the placeholder for the stored record. */
  function logActivity(b: Parameters<typeof addActivity>[1]) {
    const nowIso = new Date().toISOString();
    const draft: Activity = {
      id: -Date.now(), kind: b.kind, direction: b.direction || "outbound", outcome: b.outcome || "",
      summary: b.summary || "", pain_point: b.pain_point || "", objection: b.objection || "",
      competitor: b.competitor || "", duration_seconds: b.duration_seconds ?? null,
      contact_id: b.contact_id ?? null, by_email: me, created_at: nowIso,
    };
    const touched = b.direction !== "inbound" && ["call", "whatsapp", "email", "meeting"].includes(b.kind);
    const stage = b.set_status || "";
    mutateDetail(id, (cur) => ({
      ...cur,
      status: stage || cur.status,
      status_label: stage ? labelFor(stage) : cur.status_label,
      next_action_at: b.next_action_at !== undefined ? b.next_action_at : cur.next_action_at,
      next_action_note: b.next_action_note !== undefined ? b.next_action_note : cur.next_action_note,
      last_contacted_at: touched ? nowIso : cur.last_contacted_at,
      followup_count: touched ? (cur.followup_count || 0) + 1 : cur.followup_count,
      activities: [draft, ...cur.activities],
    }));
    patchRows(id, {
      status: stage || undefined, status_label: stage ? labelFor(stage) : undefined,
      last_contacted_at: touched ? nowIso : undefined,
      next_action_at: b.next_action_at ?? undefined,
    });
    run(() => addActivity(id, b));
  }
  function addTaskOpt(b: { title: string; due_at?: string | null }) {
    const draft: Task = { id: -Date.now(), title: b.title, due_at: b.due_at ?? null, status: "open", overdue: false, completed_at: null };
    mutateDetail(id, (cur) => ({ ...cur, tasks: [...cur.tasks, draft] }));
    run(() => addTask(id, b));
  }
  function completeTaskOpt(taskId: number) {
    mutateDetail(id, (cur) => ({
      ...cur,
      tasks: cur.tasks.map((t) => (t.id === taskId ? { ...t, status: "done", overdue: false, completed_at: new Date().toISOString() } : t)),
    }));
    run(() => completeTask(taskId));
  }

  if (!d) {
    const stub = peekRow(id);
    if (apiErr && !stub)
      return (
        <>
          <Link className="in-link" href="/console/leads">← Back to queue</Link>
          <div className="in-empty">Could not load this lead.<div className="in-err" style={{ marginTop: 8 }}>{apiErr}</div></div>
        </>
      );
    if (!stub) return <div className="in-empty">Loading lead…</div>;
    // Instant skeleton from the queue row the user just clicked.
    return (
      <>
        <div className="in-row in-wrap" style={{ marginBottom: 12 }}>
          <button className="in-btn sm" onClick={() => router.back()}>← Back</button>
          <h1 className="display" style={{ fontSize: 19, margin: 0 }}>{stub.company || "(no name)"}</h1>
          <StatusPill status={stub.status} label={stub.status_label} />
          <span className="in-right in-faint" style={{ fontSize: 11 }}>
            {stub.track}{stub.hub_city ? ` · ${stub.hub_city}` : ""}{stub.priority_rank ? ` · priority #${stub.priority_rank}` : ""}
          </span>
        </div>
        <div className="in-card in-pad">
          <div className="in-kind">Lead record</div>
          <p className="in-faint" style={{ margin: "6px 0 0" }}>Loading the full record…</p>
        </div>
      </>
    );
  }

  const co = d.company;
  const ownedByMe = !!d.owner_email && d.owner_email.toLowerCase() === (user?.email || "").toLowerCase();
  const canWork = ownedByMe || isManager || !d.owner_email;

  return (
    <>
      {/* ---- header ---- */}
      <div className="in-row in-wrap" style={{ marginBottom: 12 }}>
        <button className="in-btn sm" onClick={() => router.back()}>← Back</button>
        <h1 className="display" style={{ fontSize: 19, margin: 0 }}>{co?.name || "(no name)"}</h1>
        <StatusPill status={d.status} label={d.status_label} />
        {d.excluded_from_sales && <span className="in-pill st-dead">out of scope</span>}
        <span className="in-right in-faint" style={{ fontSize: 11 }}>
          {d.track}{co?.hub_city ? ` · ${co.hub_city}` : ""}{d.priority_rank ? ` · priority #${d.priority_rank}` : ""}
        </span>
      </div>

      {(err || apiErr) && <p className="in-err" style={{ marginBottom: 10 }}>{err || apiErr}</p>}

      {/* ---- ownership / claim bar ---- */}
      <div className="in-card" style={{ padding: "10px 14px", marginBottom: 14 }}>
        <div className="in-row in-wrap">
          <span className="in-kind">Owner</span>
          {d.owner_email
            ? <b style={{ color: "var(--txt)" }}>{d.owner_email}</b>
            : <span className="in-faint">unclaimed</span>}
          <div className="in-right in-row in-wrap">
            {!d.owner_email && <button className="in-btn primary sm" disabled={busy} onClick={claimSelf}>Claim to me</button>}
            {ownedByMe && <button className="in-btn sm" disabled={busy} onClick={releaseToPool}>Release to pool</button>}
            {isManager && <AssignControl current={d.owner_email} busy={busy} onAssign={reassign} />}
          </div>
        </div>
      </div>

      {/* ---- status stepper ---- */}
      <div className="in-card" style={{ padding: "12px 14px", marginBottom: 14 }}>
        <div className="in-kind" style={{ marginBottom: 8 }}>Stage</div>
        <div className="in-steps">
          {(meta?.stepper || []).map((s) => {
            const order = (meta?.stepper || []).map((x) => x.key);
            const curIdx = order.indexOf(d.status === "qualified" ? "connected" : d.status);
            const myIdx = order.indexOf(s.key);
            const cls = s.key === d.status || (d.status === "qualified" && s.key === "connected") ? "cur"
              : curIdx >= 0 && myIdx >= 0 && myIdx < curIdx ? "done" : "";
            return (
              <button key={s.key} className={`in-step ${cls}`} disabled={busy || !canWork}
                onClick={() => changeStatus(s.key)}>{s.label}</button>
            );
          })}
          <span className="in-faint" style={{ padding: "0 6px" }}>|</span>
          {DEAD_ENDS.map((s) => (
            <button key={s.key} className={`in-btn sm ${s.cls}`} disabled={busy || !canWork}
              onClick={() => changeStatus(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* ---- quick-action toolbar: one-tap follow-up scheduling for the rep ---- */}
      <QuickFollowUps d={d} busy={busy} canWork={canWork} onSave={saveNextStep} />

      <div className="in-detail">
        {/* ================= LEFT COLUMN ================= */}
        <div className="in-col">
          {/* Next step — pinned to the top so the key action is always in view */}
          <NextStepEditor d={d} busy={busy} canWork={canWork} onSave={saveNextStep} />

          {/* Company (read-only, compacted) */}
          <div className="in-card in-pad">
            <div className="in-kind" style={{ marginBottom: 6 }}>Company</div>
            <CompanyPanel d={d} />
          </div>

          {/* Contacts */}
          <div className="in-card in-pad">
            <div className="in-kind" style={{ marginBottom: 8 }}>Contacts · {d.contacts.length}</div>
            {!d.contacts.length && <p className="in-faint" style={{ margin: 0 }}>No contacts recorded.</p>}
            {d.contacts.map((c) => <ContactRow key={c.id} c={c} />)}
          </div>

          {/* Script */}
          {d.script && (
            <div className="in-card in-pad">
              <div className="in-kind" style={{ marginBottom: 8 }}>Call script · {d.script.name}</div>
              <ScriptPanel script={d.script} />
            </div>
          )}
        </div>

        {/* ================= RIGHT COLUMN ================= */}
        <div className="in-col">
          {/* Log a touchpoint */}
          <div className="in-card in-pad">
            <div className="in-kind" style={{ marginBottom: 8 }}>Log a touchpoint</div>
            <ActivityForm d={d} meta={meta} busy={busy} canWork={canWork} onSubmit={logActivity} />
          </div>

          {/* Tasks */}
          <TaskPanel d={d} busy={busy} canWork={canWork}
            onAdd={addTaskOpt}
            onComplete={completeTaskOpt} />

          {/* Timeline */}
          <div className="in-card in-pad">
            <div className="in-kind" style={{ marginBottom: 4 }}>Activity timeline · {d.activities.length}</div>
            {!d.activities.length && <p className="in-faint" style={{ margin: "8px 0" }}>No touchpoints yet.</p>}
            <div className="in-tl">
              {d.activities.map((a) => <ActivityItem key={a.id} a={a} />)}
            </div>
          </div>

          {/* Status history */}
          {d.history.length > 0 && (
            <div className="in-card in-pad">
              <div className="in-kind" style={{ marginBottom: 4 }}>Status history</div>
              <div className="in-tl">
                {d.history.map((h) => (
                  <div key={h.id} className="in-tlitem">
                    <div className="in-tldot" />
                    <div>
                      <div className="in-kind">{h.from_label !== h.to_label ? `${h.from_label} → ${h.to_label}` : h.to_label || "change"}</div>
                      <div className="in-faint" style={{ fontSize: 11 }}>{fmtDate(h.changed_at, true)} · {h.by_email}{h.note ? ` — ${h.note}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ company
function CompanyPanel({ d }: { d: LeadDetail }) {
  const co = d.company;
  const links: { label: string; href: string }[] = [];
  if (co?.website) links.push({ label: "Website", href: co.website });
  if (co?.gmb_link) links.push({ label: "Google", href: co.gmb_link });
  if (co?.linkedin_url) links.push({ label: "LinkedIn", href: co.linkedin_url });
  // read-only reference data → tight 2-column grid (full-width for long values)
  const fields: { k: string; v: string; wide?: boolean }[] = [];
  fields.push({ k: "Category", v: `${co?.category_primary || "—"}${co?.category_tier ? ` · t${co.category_tier}` : ""}` });
  fields.push({ k: "Size", v: co?.size_band || "—" });
  if (co?.category_tags?.length) fields.push({ k: "Tags", v: co.category_tags.join(", "), wide: true });
  if (co?.address) fields.push({ k: "Address", v: co.address, wide: true });
  if (co?.cin) fields.push({ k: "CIN", v: co.cin });
  if (co?.gst) fields.push({ k: "GST", v: co.gst });
  if (co?.review_rating) fields.push({ k: "Reviews", v: `${co.review_rating}★ (${co.review_count})` });
  return (
    <div className="in-co">
      {co?.what_they_do && <p className="in-co-desc">{co.what_they_do}</p>}
      <div className="in-co-grid">
        {fields.map((f) => (
          <div key={f.k} className={f.wide ? "span2" : undefined}>
            <span className="k">{f.k}</span>
            <span className="v">{f.v}</span>
          </div>
        ))}
      </div>
      {links.length > 0 && (
        <div className="in-row in-wrap" style={{ marginTop: 10 }}>
          {links.map((l) => <a key={l.label} className="in-btn sm" href={withProto(l.href)} target="_blank" rel="noreferrer">↗ {l.label}</a>)}
        </div>
      )}
      <div className="in-co-src">
        Source: {co?.source_system || d.source || "—"}{co?.source_note ? ` · ${co.source_note}` : ""}
      </div>
    </div>
  );
}

function withProto(u: string): string {
  if (!u) return "#";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

// ------------------------------------------------------------------ contacts
function ContactRow({ c }: { c: Contact }) {
  const tel = c.phone_primary || c.phone_secondary;
  const wa = c.whatsapp || tel;
  const actions: React.ReactNode[] = [];
  if (tel && !c.do_not_call) actions.push(<a key="call" className="in-btn sm" href={`tel:${tel}`}>☎ {tel}</a>);
  if (wa && !c.do_not_call) actions.push(<a key="wa" className="in-btn sm" href={`https://wa.me/${digits(wa)}`} target="_blank" rel="noreferrer">✆ WhatsApp</a>);
  if (c.email) actions.push(<a key="mail" className="in-btn sm" href={`mailto:${c.email}`}>✉ Email</a>);
  if (c.do_not_call) actions.push(<span key="dnc" className="in-pill st-dead">do-not-call</span>);
  return (
    <div className="in-contact">
      <div className="in-row in-wrap" style={{ gap: 6 }}>
        <b style={{ color: "var(--txt)" }}>{c.full_name || "(unnamed)"}</b>
        {c.is_primary && <span className="in-pill st-conversation">primary</span>}
        {c.decision_maker && <span className="in-pill st-onboarded">decision maker</span>}
      </div>
      {c.designation && <div className="in-faint" style={{ fontSize: 11 }}>{c.designation}{c.preferred_channel ? ` · prefers ${c.preferred_channel}` : ""}</div>}
      <div className="in-row in-wrap" style={{ gap: 6, marginTop: 6 }}>
        {actions.length ? actions : <span className="in-faint" style={{ fontSize: 11 }}>no reachable channel</span>}
      </div>
    </div>
  );
}
function digits(s: string): string { return (s || "").replace(/\D/g, "").replace(/^0+/, ""); }

// ------------------------------------------------------------------ activity form
function ActivityForm({ d, meta, busy, canWork, onSubmit }: {
  d: LeadDetail; meta: ReturnType<typeof useConsole>["meta"]; busy: boolean; canWork: boolean;
  onSubmit: (b: Parameters<typeof addActivity>[1]) => void;
}) {
  const [kind, setKind] = useState("call");
  const [outcome, setOutcome] = useState("");
  const [summary, setSummary] = useState("");
  const [pain, setPain] = useState("");
  const [objection, setObjection] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [contactId, setContactId] = useState<number | "">("");
  const [nextAt, setNextAt] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [setStatusTo, SetStatusTo] = useState("");

  if (!canWork)
    return <p className="in-faint" style={{ margin: 0 }}>This lead is owned by {d.owner_email}. Only the owner or a manager can log activity.</p>;

  return (
    <div className="in-form">
      <div className="in-grid2">
        <label><span className="in-lbl">Kind</span>
          <select className="in-field" value={kind} onChange={(e) => setKind(e.target.value)}>
            {(meta?.activity_kinds || ["call", "whatsapp", "email", "meeting", "note", "voicemail"]).map((k) => <option key={k} value={k}>{KIND_ICON[k] || ""} {k}</option>)}
          </select>
        </label>
        <label><span className="in-lbl">Outcome</span>
          <select className="in-field" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">—</option>
            {(meta?.activity_outcomes || []).map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </div>
      <label><span className="in-lbl">Contact (optional)</span>
        <select className="in-field" value={contactId} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">— none —</option>
          {d.contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email || c.phone_primary || `#${c.id}`}</option>)}
        </select>
      </label>
      <label><span className="in-lbl">Notes / summary</span>
        <textarea className="in-field" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened, what they said…" />
      </label>
      <div className="in-grid3">
        <label><span className="in-lbl">Pain point</span><input className="in-field" value={pain} onChange={(e) => setPain(e.target.value)} /></label>
        <label><span className="in-lbl">Objection</span><input className="in-field" value={objection} onChange={(e) => setObjection(e.target.value)} /></label>
        <label><span className="in-lbl">Competitor</span><input className="in-field" value={competitor} onChange={(e) => setCompetitor(e.target.value)} /></label>
      </div>
      <div className="in-grid2">
        <label><span className="in-lbl">Next action</span>
          <input type="datetime-local" className="in-field" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
        </label>
        <label><span className="in-lbl">Move stage to</span>
          <select className="in-field" value={setStatusTo} onChange={(e) => SetStatusTo(e.target.value)}>
            <option value="">— no change —</option>
            {(meta?.statuses || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <label><span className="in-lbl">Next-step note</span><input className="in-field" value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="e.g. call back Monday AM" /></label>
      <button className="in-btn primary block" disabled={busy || !summary.trim()}
        onClick={() => onSubmit({
          kind, outcome: outcome || undefined, summary: summary.trim(),
          pain_point: pain || undefined, objection: objection || undefined, competitor: competitor || undefined,
          contact_id: contactId === "" ? null : contactId,
          next_action_at: nextAt ? new Date(nextAt).toISOString() : null,
          next_action_note: nextNote || undefined,
          set_status: setStatusTo || null,
        })}>
        {busy ? "Saving…" : "＋ Log touchpoint"}
      </button>
    </div>
  );
}

function ActivityItem({ a }: { a: Activity }) {
  return (
    <div className="in-tlitem">
      <div className={`in-tldot ${a.kind}`} />
      <div>
        <div className="in-row in-wrap" style={{ gap: 8 }}>
          <span className="in-kind">{KIND_ICON[a.kind] || ""} {a.kind}{a.direction === "inbound" ? " · inbound" : ""}</span>
          {a.outcome && <span className="in-faint" style={{ fontSize: 11 }}>{a.outcome.replace(/_/g, " ")}</span>}
          <span className="in-right in-faint" style={{ fontSize: 11 }}>{fmtDate(a.created_at, true)}</span>
        </div>
        {a.summary && <div className="in-muted" style={{ marginTop: 3, whiteSpace: "pre-wrap" }}>{a.summary}</div>}
        {(a.pain_point || a.objection || a.competitor) && (
          <div className="in-faint" style={{ fontSize: 11, marginTop: 3 }}>
            {a.pain_point ? `pain: ${a.pain_point} · ` : ""}{a.objection ? `objection: ${a.objection} · ` : ""}{a.competitor ? `competitor: ${a.competitor}` : ""}
          </div>
        )}
        <div className="in-faint" style={{ fontSize: 10, marginTop: 2 }}>{a.by_email}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tasks
function TaskPanel({ d, busy, canWork, onAdd, onComplete }: {
  d: LeadDetail; busy: boolean; canWork: boolean;
  onAdd: (b: { title: string; due_at?: string | null }) => void; onComplete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const open = d.tasks.filter((t) => t.status !== "done");
  const done = d.tasks.filter((t) => t.status === "done");
  return (
    <div className="in-card in-pad">
      <div className="in-kind" style={{ marginBottom: 8 }}>Follow-ups · {open.length} open</div>
      {open.map((t) => <TaskRow key={t.id} t={t} busy={busy} onComplete={onComplete} />)}
      {done.map((t) => <TaskRow key={t.id} t={t} busy={true} done onComplete={() => {}} />)}
      {canWork && (
        <div className="in-form" style={{ marginTop: open.length || done.length ? 12 : 0 }}>
          <input className="in-field" placeholder="New follow-up title…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="in-row" style={{ gap: 8 }}>
            <input type="datetime-local" className="in-field" value={due} onChange={(e) => setDue(e.target.value)} />
            <button className="in-btn" disabled={busy || !title.trim()} onClick={() => { onAdd({ title: title.trim(), due_at: due ? new Date(due).toISOString() : null }); setTitle(""); setDue(""); }}>＋ Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
function TaskRow({ t, busy, done, onComplete }: { t: Task; busy: boolean; done?: boolean; onComplete: (id: number) => void }) {
  const rel = t.due_at ? relTime(t.due_at) : null;
  return (
    <div className="in-task">
      {done
        ? <span className="in-check done">✓</span>
        : <button className="in-check" disabled={busy} title="Mark done" onClick={() => onComplete(t.id)} />}
      <div className="in-grow">
        <div className={done ? "in-faint" : ""} style={done ? { textDecoration: "line-through" } : undefined}>{t.title}</div>
        {t.due_at && !done && <div className="in-faint" style={{ fontSize: 11, color: t.overdue ? "var(--bad)" : undefined }}>{fmtDate(t.due_at, true)} · {rel?.text}{t.overdue ? " (overdue)" : ""}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ next step
function NextStepEditor({ d, busy, canWork, onSave }: {
  d: LeadDetail; busy: boolean; canWork: boolean; onSave: (b: { next_action_at: string | null; next_action_note: string }) => void;
}) {
  const localIso = (iso: string | null) => {
    if (!iso) return "";
    const dt = new Date(iso); if (isNaN(dt.getTime())) return "";
    const off = dt.getTimezoneOffset();
    return new Date(dt.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const [at, setAt] = useState(localIso(d.next_action_at));
  const [note, setNote] = useState(d.next_action_note || "");
  useEffect(() => { setAt(localIso(d.next_action_at)); setNote(d.next_action_note || ""); }, [d.id, d.next_action_at, d.next_action_note]);
  const rel = d.next_action_at ? relTime(d.next_action_at) : null;
  return (
    <div className="in-card in-pad in-nextstep">
      <div className="in-kind" style={{ marginBottom: 6 }}>Next step</div>
      {d.next_action_at ? (
        <div className="in-muted" style={{ marginBottom: 8, fontSize: 12 }}>
          Due {fmtDate(d.next_action_at, true)} · <span style={{ color: rel?.overdue ? "var(--bad)" : undefined }}>{rel?.text}{rel?.overdue ? " (overdue)" : ""}</span>
          {d.next_action_note ? <div className="in-faint" style={{ marginTop: 2 }}>{d.next_action_note}</div> : null}
        </div>
      ) : <div className="in-faint" style={{ marginBottom: 8, fontSize: 12 }}>No next action scheduled.</div>}
      {canWork && (
        <div className="in-form">
          <input type="datetime-local" className="in-field" value={at} onChange={(e) => setAt(e.target.value)} />
          <input className="in-field" placeholder="What / when to do next…" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="in-row" style={{ gap: 8 }}>
            <button className="in-btn" disabled={busy} onClick={() => onSave({ next_action_at: at ? new Date(at).toISOString() : null, next_action_note: note })}>Save next step</button>
            {d.next_action_at && <button className="in-btn sm" disabled={busy} onClick={() => onSave({ next_action_at: null, next_action_note: "" })}>Clear</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ quick actions
// One-tap follow-up presets so a rep can schedule the next step without touching
// the date picker; preserves any existing note (or seeds a sensible default).
function QuickFollowUps({ d, busy, canWork, onSave }: {
  d: LeadDetail; busy: boolean; canWork: boolean;
  onSave: (b: { next_action_at: string | null; next_action_note: string }) => void;
}) {
  if (!canWork) return null;
  const at = (dayOffset: number, hour: number) => {
    const dt = new Date(); dt.setDate(dt.getDate() + dayOffset); dt.setHours(hour, 0, 0, 0);
    return dt.toISOString();
  };
  const note = d.next_action_note || "Follow up";
  const presets: { label: string; iso: string }[] = [
    { label: "Today 5pm", iso: at(0, 17) },
    { label: "Tomorrow AM", iso: at(1, 10) },
    { label: "+3 days", iso: at(3, 10) },
    { label: "+7 days", iso: at(7, 10) },
  ];
  return (
    <div className="in-card" style={{ padding: "10px 14px", marginBottom: 14 }}>
      <div className="in-row in-wrap" style={{ gap: 8 }}>
        <span className="in-kind">Quick</span>
        {presets.map((p) => (
          <button key={p.label} className="in-step" disabled={busy}
            onClick={() => onSave({ next_action_at: p.iso, next_action_note: note })}>⟳ {p.label}</button>
        ))}
        {d.next_action_at && (
          <button className="in-btn sm" disabled={busy}
            onClick={() => onSave({ next_action_at: null, next_action_note: "" })}>Clear next step</button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ script
function ScriptPanel({ script }: { script: NonNullable<LeadDetail["script"]> }) {
  return (
    <div className="in-script">
      {script.opener?.length ? <><div className="in-kind2">Opener</div><ul>{script.opener.map((s, i) => <li key={i}>{s}</li>)}</ul></> : null}
      {script.pitch ? <><div className="in-kind2">Pitch</div><p>{script.pitch}</p></> : null}
      {script.discovery_questions?.length ? <><div className="in-kind2">Discovery</div><ul>{script.discovery_questions.map((s, i) => <li key={i}>{s}</li>)}</ul></> : null}
      {script.qualification_checklist?.length ? <><div className="in-kind2">Qualify</div><ul>{script.qualification_checklist.map((s, i) => <li key={i}>{s}</li>)}</ul></> : null}
      {script.cta ? <><div className="in-kind2">CTA</div><p>{script.cta}</p></> : null}
      {script.do_not_say ? <><div className="in-kind2">Do not say</div><p className="in-faint">{script.do_not_say}</p></> : null}
    </div>
  );
}

// ------------------------------------------------------------------ manager assign
function AssignControl({ current, busy, onAssign }: {
  current: string; busy: boolean; onAssign: (email: string) => void;
}) {
  const [email, setEmail] = useState(current || "");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  function go(owner: string) {
    setErr("");
    if (!owner && !current) { setErr("Enter a rep email, or use Release to pool"); return; }
    onAssign(owner); setOpen(false);
  }
  if (!open) return <button className="in-btn sm" onClick={() => setOpen(true)}>Reassign</button>;
  return (
    <div className="in-row in-wrap" style={{ gap: 6 }}>
      <input className="in-field" style={{ maxWidth: 220 }} placeholder="rep email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="in-btn primary sm" disabled={busy} onClick={() => go(email.trim())}>Assign</button>
      {current && <button className="in-btn sm" disabled={busy} onClick={() => go("")}>To pool</button>}
      <button className="in-btn sm" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button>
      {err && <span className="in-err" style={{ fontSize: 11 }}>{err}</span>}
    </div>
  );
}
