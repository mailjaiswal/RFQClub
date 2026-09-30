"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Command = { id: string; label: string; hint?: string; group: string; run: () => void };

const Ctx = createContext<{ open: () => void }>({ open: () => {} });
export const useCommand = () => useContext(Ctx);

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const go = useCallback((path: string) => () => { setShow(false); router.push(path); }, [router]);

  const commands = useMemo<Command[]>(
    () => [
      { id: "board", label: "Open RFQ board", hint: "/", group: "Go", run: go("/") },
      { id: "hiw", label: "How it works", hint: "/how-it-works", group: "Go", run: go("/how-it-works") },
      { id: "post", label: "Post an RFQ (concierge)", hint: "/how-it-works#post", group: "Actions", run: go("/how-it-works") },
    ],
    [go],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  const open = useCallback(() => { setShow(true); setQuery(""); setActive(0); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShow((s) => !s);
      } else if (e.key === "Escape") {
        setShow(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (show) setTimeout(() => inputRef.current?.focus(), 10);
  }, [show]);

  useEffect(() => { setActive(0); }, [query]);

  const onArrow = (delta: number) =>
    setActive((a) => (filtered.length ? (a + delta + filtered.length) % filtered.length : 0));

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {show && (
        <>
          <div className="cmdk-overlay" onClick={() => setShow(false)} />
          <div className="cmdk-panel" role="dialog" aria-label="Command palette">
            <input
              ref={inputRef}
              className="field"
              style={{ border: "none", borderRadius: 0, borderBottom: "1px solid var(--hairline)", padding: "14px 16px" }}
              placeholder="Jump to a screen or action…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); onArrow(1); }
                else if (e.key === "ArrowUp") { e.preventDefault(); onArrow(-1); }
                else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
              }}
            />
            <div style={{ maxHeight: "56vh", overflowY: "auto", padding: "6px 0" }}>
              {filtered.length === 0 && (
                <div className="muted" style={{ padding: "16px" }}>No matches.</div>
              )}
              {filtered.map((c, i) => (
                <div
                  key={c.id}
                  className="cmdk-item"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => c.run()}
                >
                  <span className="chip" style={{ padding: "2px 8px", fontSize: 10 }}>{c.group}</span>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {c.hint && <span className="mono muted" style={{ fontSize: 11 }}>{c.hint}</span>}
                </div>
              ))}
            </div>
            <div className="muted" style={{ padding: "8px 16px", borderTop: "1px solid var(--hairline)", fontSize: 11 }}>
              <kbd>↑</kbd> <kbd>↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>esc</kbd> close
            </div>
          </div>
        </>
      )}
    </Ctx.Provider>
  );
}
