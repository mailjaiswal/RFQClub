"use client";
// Useful Assets — the shared reference library for the inside-sales team.
// Call scripts, email templates, objection-handling sheets, product one-pagers:
// anything a rep should keep handy. The whole team can upload and download; a
// file can be removed only by whoever uploaded it or by a manager/owner (the
// server decides and echoes `can_delete`, so the client never guesses).
//
// Render free-tier has no persistent disk, so the bytes live in the DB and are
// moved as base64 through the JSON API — see lib/sales-api.ts upload/download.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmPopup } from "@/components/console/ConsoleApp";
import { fmtDate } from "@/components/console/ui";
import {
  deleteAsset, downloadAsset, fileToBase64, getAssets, uploadAsset,
  type AssetMeta,
} from "@/lib/sales-api";

const msg = (e: unknown) => String((e as Error)?.message || e);

// Kept loose on purpose (the server stores any string) — these are just the
// quick-pick labels so uploads stay tidy; a rep can type their own via "Other".
const CATEGORIES = [
  "General", "Call script", "Email template", "Objection handling",
  "Proposal / quote", "Product / pricing", "Training", "Compliance",
];
const MAX_BYTES = 8 * 1024 * 1024; // matches ASSET_MAX_BYTES on the server

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

type Pending = { title: string; body: string; danger?: boolean; run: () => Promise<void> };

export default function AssetsPage() {
  const [rows, setRows] = useState<AssetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  // upload form
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { const r = await getAssets(); setRows(r.items); }
    catch (e) { setErr(msg(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group by category for a scannable library; "General" floats to the bottom.
  const groups = useMemo(() => {
    const map = new Map<string, AssetMeta[]>();
    for (const a of rows) {
      const k = a.category || "General";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === "General") return 1;
      if (b[0] === "General") return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [rows]);

  function pickFile(f: File | null) {
    setErr(""); setFlash("");
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) { setErr(`That file is ${fmtBytes(f.size)} — the limit is 8 MB.`); return; }
    setFile(f);
    // Suggest a title from the filename the first time, unless one is typed.
    if (!title) setTitle(f.name.replace(/\.[^./\\]+$/, ""));
  }

  function resetForm() {
    setFile(null); setTitle(""); setCategory("General"); setDescription("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submitUpload() {
    setErr(""); setFlash("");
    if (!file) { setErr("Choose a file to upload."); return; }
    if (!title.trim()) { setErr("Give it a title so the team can find it."); return; }
    setBusy(true);
    try {
      const data_base64 = await fileToBase64(file);
      await uploadAsset({
        title: title.trim(), category: category.trim() || "General",
        description: description.trim(), filename: file.name,
        content_type: file.type || "application/octet-stream", data_base64,
      });
      resetForm();
      setFlash(`“${title.trim()}” is now available to the whole team.`);
      await load();
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  async function saveDownload(a: AssetMeta) {
    setErr(""); setFlash("");
    try { await downloadAsset(a.id, a.filename || a.title); }
    catch (e) { setErr(msg(e)); }
  }

  function askDelete(a: AssetMeta) {
    setErr(""); setFlash("");
    setPending({
      title: "Confirm — delete asset", danger: true,
      body: `Delete “${a.title}” (${a.filename})? This removes the shared copy for the whole team. `,
      run: async () => { await deleteAsset(a.id); setFlash(`“${a.title}” was deleted.`); },
    });
  }

  async function runConfirm() {
    if (!pending) return;
    const p = pending; setPending(null); setErr(""); setFlash("");
    try { await p.run(); await load(); }
    catch (e) { setErr(msg(e)); }
  }

  return (
    <>
      <div className="in-row in-wrap" style={{ marginBottom: 8 }}>
        <h1 className="display" style={{ fontSize: 20, margin: 0 }}>Useful assets</h1>
        <span className="in-tag" style={{ marginLeft: "auto" }}>{rows.length} reference files</span>
      </div>
      <p className="in-muted" style={{ margin: "0 0 16px", fontSize: 12 }}>
        The team's shared shelf — call scripts, email templates, objection handling, product sheets.
        Anyone here can upload a file or download a copy. A file can be deleted by whoever
        uploaded it, or by a manager.
      </p>

      {err && <p className="in-err" style={{ marginBottom: 12 }}>{err}</p>}
      {flash && <p className="in-ok" style={{ marginBottom: 12 }}>{flash}</p>}

      {/* ---- upload ---- */}
      <div className="in-card in-pad" style={{ marginBottom: 18 }}>
        <div className="in-sec-h" style={{ marginTop: 0 }}>Upload a reference file</div>
        <div className="in-row in-wrap" style={{ gap: 10, marginBottom: 10 }}>
          <input ref={fileRef} type="file" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
          {file && <span className="in-faint" style={{ fontSize: 12 }}>
            {file.name} · {fmtBytes(file.size)}</span>}
        </div>
        <div className="in-grid3">
          <label><span className="in-lbl">Title</span>
            <input className="in-field" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. First-call opener script" /></label>
          <label><span className="in-lbl">Category</span>
            <select className="in-field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label><span className="in-lbl">Note (optional)</span>
            <input className="in-field" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="When to use it / version" /></label>
        </div>
        <div className="in-row" style={{ marginTop: 12, gap: 10 }}>
          <button className="in-btn primary" onClick={submitUpload}
            disabled={busy || !file}>
            {busy ? "Uploading…" : "+ Upload to library"}</button>
          {(file || title || description) && (
            <button className="in-btn" onClick={resetForm} disabled={busy}>Clear</button>
          )}
        </div>
      </div>

      {/* ---- library ---- */}
      {loading ? <p className="in-faint">Loading library…</p>
        : !rows.length ? <div className="in-empty">No files yet — upload the first reference above.</div>
        : groups.map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 18 }}>
            <div className="in-sec-h">{cat}</div>
            <div className="in-card in-scroll-x" style={{ overflow: "hidden" }}>
              <table className="in-table">
                <thead>
                  <tr><th>File</th><th>Uploaded by</th><th>Date</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="co">{a.title}</div>
                        <div className="sub">{a.filename} · {fmtBytes(a.size_bytes)}
                          {a.description ? ` — ${a.description}` : ""}</div>
                      </td>
                      <td className="sub">{a.uploaded_by_email || "—"}</td>
                      <td className="sub">{fmtDate(a.updated_at || a.created_at)}</td>
                      <td>
                        <div className="in-row" style={{ gap: 6, justifyContent: "flex-end" }}>
                          <button className="in-btn sm primary" onClick={() => saveDownload(a)}>⭳ Download</button>
                          {a.can_delete && (
                            <button className="in-btn sm bad" onClick={() => askDelete(a)}>Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {pending && (
        <ConfirmPopup
          title={pending.title}
          body={pending.body}
          danger={pending.danger}
          confirmLabel="Delete"
          onCancel={() => setPending(null)}
          onConfirm={runConfirm} />
      )}
    </>
  );
}
