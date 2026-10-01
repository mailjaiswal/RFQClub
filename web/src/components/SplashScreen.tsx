"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Option 1 — "The process story" splash.
 * Plays six scenes once (Post → Route → Bid → Compare → Award → logo), then
 * cross-fades away to reveal the already-mounted landing page underneath.
 * Rendered at 1.5× speed (durations below are the 1× base).
 */
const SPEED = 1.5;
const DUR = [1400, 1700, 1600, 1700, 2000, 2000]; // ms per scene at 1×
const SCENES = DUR.length;
const LEAVE_MS = 500; // matches the .rc-leaving opacity transition

const SPOKES = [
  { a: "0deg", d: ".05s" },
  { a: "72deg", d: ".15s" },
  { a: "144deg", d: ".25s" },
  { a: "216deg", d: ".35s" },
  { a: "288deg", d: ".45s" },
];
const SHOPS = [
  { c: "var(--cnc)", d: ".15s", left: "92%", top: "50%", em: "⚙" },
  { c: "var(--foundry)", d: ".28s", left: "63%", top: "90%", em: "🔥" },
  { c: "var(--sheet)", d: ".41s", left: "16%", top: "75%", em: "▦" },
  { c: "var(--auto)", d: ".54s", left: "16%", top: "25%", em: "🛞" },
  { c: "var(--elec)", d: ".67s", left: "63%", top: "10%", em: "⚡" },
];

// helper so we can pass CSS custom properties inline in TS
const v = (o: Record<string, string>) => o as CSSProperties;

export default function SplashScreen() {
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    if (finished.current) return;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* ignore */
    }

    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      setLeaving(true);
      timer = setTimeout(() => setGone(true), LEAVE_MS);
    };

    if (reduce) {
      setIdx(SCENES - 1); // jump straight to the logo
      timer = setTimeout(finish, 1200);
      return () => clearTimeout(timer);
    }

    const advance = (n: number) => {
      if (n >= SCENES) {
        finish();
        return;
      }
      setIdx(n);
      timer = setTimeout(() => advance(n + 1), DUR[n] / SPEED);
    };
    advance(0);
    return () => clearTimeout(timer);
  }, []);

  if (gone) return null;

  const skip = () => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    setTimeout(() => setGone(true), LEAVE_MS);
  };

  const sc = (n: number) => "scene" + (idx === n ? " on" : "");

  return (
    <div className={"rc-splash" + (leaving ? " rc-leaving" : "")}>
      <div className="grid-bg" />
      <button className="skip" onClick={skip} aria-label="Skip intro">
        Skip →
      </button>

      {/* 1 · POST */}
      <section className={sc(0)}>
        <div className="doc">
          <div className="tag">RFQ · NEW</div>
          <h4>SS3 flanges, CNC turned</h4>
          <div className="ln" />
          <div className="ln s" />
          <div className="ln" />
          <div className="qty">12,000 pcs</div>
        </div>
        <div className="cap">
          Post an <b>RFQ</b>
        </div>
      </section>

      {/* 2 · ROUTE */}
      <section className={sc(1)}>
        <div className="ring">
          <div className="core">📋</div>
          {SPOKES.map((s, k) => (
            <div key={k} className="spoke" style={v({ "--a": s.a, "--d": s.d })} />
          ))}
          {SHOPS.map((s, k) => (
            <div key={k} className="shop" style={v({ "--c": s.c, "--d": s.d, left: s.left, top: s.top })}>
              {s.em}
            </div>
          ))}
        </div>
        <div className="cap">
          Routed to <b>5 vetted shops</b>
        </div>
      </section>

      {/* 3 · BLINDED BIDS */}
      <section className={sc(2)}>
        <div className="row">
          {["A", "B", "C", "D", "E"].map((code, k) => (
            <div key={code} className="env" style={v({ "--d": `.${5 + k * 10}s` })}>
              <div className="code">{code}</div>
              <div className="mask">SEALED</div>
            </div>
          ))}
        </div>
        <div className="cap">
          <b>Blinded bids</b> in — identities hidden
        </div>
      </section>

      {/* 4 · COMPARE */}
      <section className={sc(3)}>
        <div className="row" style={{ position: "relative" }}>
          {["A", "B", "C", "D", "E"].map((code) => (
            <div key={code} className={"env" + (code === "D" ? " win" : "")}>
              <div className="code">{code}</div>
              <div className="mask">{code === "D" ? "LOWEST" : "SEALED"}</div>
            </div>
          ))}
          <div className="glass" />
        </div>
        <div className="best">▸ ranked on total landed cost</div>
        <div className="cap">
          Compare the <b>sealed bids</b>
        </div>
      </section>

      {/* 5 · AWARD + REVEAL */}
      <section className={sc(4)}>
        <div className="stack">
          <div className="stamp">Award</div>
          <div className="badge">
            <div className="k">Winner · bid D revealed</div>
            <div className="n">
              <span className="dot" />
              Coimbatore Precision Works
            </div>
            <div className="meta">
              <span>18-day lead</span>
              <span className="tlc">₹ 41.20 / pc</span>
            </div>
          </div>
        </div>
        <div className="cap">
          <b>Award</b> one — winner revealed
        </div>
      </section>

      {/* 6 · LOGO REVEAL */}
      <section className={sc(5)}>
        <div className="logo">
          <svg className="logo-mark" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M18 20h46a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8H44l-14 12v-12h-12a8 8 0 0 1-8-8V28a8 8 0 0 1 8-8Z" fill="#fff" stroke="#1D1C19" strokeWidth="3.4" strokeLinejoin="round" />
            <circle cx="34" cy="34" r="4.4" fill="#3F4397" />
            <circle cx="56" cy="34" r="4.4" fill="#EF7A2B" />
            <circle cx="45" cy="52" r="4.4" fill="#2E6E46" />
            <path d="M34 34 45 52M56 34 45 52" stroke="#1D1C19" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <div className="wordmark">
            RFQClub<b>.</b>
          </div>
          <div className="tagline">Post · Route · Bid · Award</div>
        </div>
        <div className="cap" style={{ bottom: "16%" }}>The RFQ network for Indian job shops</div>
      </section>

      <div className="dots">
        {DUR.map((_, k) => (
          <i key={k} className={k === idx ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}
