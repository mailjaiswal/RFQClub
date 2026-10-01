"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";

/* ------------------------------------------------------------------ */
/* Scroll-reveal wrapper                                               */
/* ------------------------------------------------------------------ */
function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("in");
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`lp-r ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Animated process device — one scene at a time (no overlap)          */
/* ------------------------------------------------------------------ */
const STAGES = [
  { key: "intake", label: "Ingest", cap: "You send the requirement however it already lives — <b>WhatsApp, a voice note, a drawing or a form.</b>" },
  { key: "struct", label: "Normalise", cap: "RFQClub maps it to an industry schema and <b>asks before it routes</b> — gaps become a clarify message to you." },
  { key: "route", label: "Distribute", cap: "The structured RFQ goes to a <b>ranked shortlist of at most 5 verified shops</b> who actually make this part." },
  { key: "collect", label: "Collect", cap: "Quotes come back by voice, PDF or text. <b>Suppliers can't see each other</b> — bids stay blinded." },
  { key: "compare", label: "Decide", cap: "Everything is normalised to <b>total landed cost</b>, so you compare like-for-like and award with a recommendation." },
];

function Device() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((n) => (n + 1) % STAGES.length), 2900);
    return () => clearTimeout(t);
  }, [i, paused]);

  const scene = (n: number) => `lp-scene${i === n ? " on" : ""}`;

  return (
    <div className="lp-dev">
      <div className="lp-devbar">
        <span className="lp-dots3"><i /><i /><i /></span>
        <span className="lp-devtitle">rfqclub · live process</span>
        <button className="lp-devpause" onClick={() => setPaused((p) => !p)} aria-label="Pause or resume animation">
          {paused ? "▶ Resume" : "❚❚ Pause"}
        </button>
      </div>

      <div className="lp-view">
        {/* 1 · Intake */}
        <div className={scene(0)}>
          <span className="lp-slabel"><b>01</b> · Ingest</span>
          <div className="lp-channels">
            <span className="lp-chip">💬 WhatsApp text</span>
            <span className="lp-chip">🎙 Voice note</span>
            <span className="lp-chip">📐 Drawing / PDF</span>
            <span className="lp-chip">✍ Web form</span>
          </div>
          <div className="lp-arrow" />
          <div className="lp-core">RFQ<br />Club</div>
        </div>

        {/* 2 · Structure */}
        <div className={scene(1)}>
          <span className="lp-slabel"><b>02</b> · Normalise</span>
          <div className="lp-form">
            <div className="lp-fhead"><span className="live" /> Structured RFQ · 0451</div>
            <div className="lp-frow"><span>Material</span><b>Duplex 2205</b></div>
            <div className="lp-frow"><span>Quantity</span><b>1,200 pcs</b></div>
            <div className="lp-frow"><span>Standard</span><b>ISO 2768-k</b></div>
            <div className="lp-frow"><span>Deadline</span><b>25 days</b></div>
            <div className="lp-clarify">⚠ Clarify → “Confirm ± tolerance on the sealing face?”</div>
          </div>
        </div>

        {/* 3 · Route */}
        <div className={scene(2)}>
          <span className="lp-slabel"><b>03</b> · Distribute</span>
          <div className="lp-route">
            <div className="lp-core sm">RFQ</div>
            <div className="lp-spokes">
              <span className="lp-spoke" /><span className="lp-spoke" /><span className="lp-spoke" /><span className="lp-spoke" /><span className="lp-spoke" />
            </div>
            <div className="lp-shops">
              <span className="lp-shop"><i /> CNC · Pune</span>
              <span className="lp-shop"><i /> Foundry · Rajkot</span>
              <span className="lp-shop"><i /> Sheet metal · Coimbatore</span>
              <span className="lp-shop"><i /> Auto components · Nagpur</span>
              <span className="lp-shop"><i /> Fabrication · Hyderabad</span>
            </div>
          </div>
          <span className="lp-cap5">capped at 5 · ranked to capability</span>
        </div>

        {/* 4 · Collect */}
        <div className={scene(3)}>
          <span className="lp-slabel"><b>04</b> · Collect</span>
          <div className="lp-quotes">
            <div className="lp-q"><span>Quote · ₹640/unit</span><span className="lock">🔒 blinded</span></div>
            <div className="lp-q"><span>Quote · ₹610/unit</span><span className="lock">🔒 blinded</span></div>
            <div className="lp-q"><span>Quote · ₹655/unit</span><span className="lock">🔒 blinded</span></div>
            <div className="lp-q"><span>Quote · voice → text</span><span className="lock">🔒 blinded</span></div>
            <div className="lp-q"><span>Quote · PDF → parsed</span><span className="lock">🔒 blinded</span></div>
          </div>
          <span className="lp-blind">🔒 No supplier sees another's price until you award</span>
        </div>

        {/* 5 · Compare */}
        <div className={scene(4)}>
          <span className="lp-slabel"><b>05</b> · Decide</span>
          <div className="lp-cmp">
            <div className="lp-bar-row best">
              <span className="nm">Ganesh P.</span>
              <div className="lp-track"><div className="lp-fill" style={{ ["--w" as string]: "58%" }} /></div>
              <span className="amt">₹8.6 L</span>
            </div>
            <div className="lp-bar-row">
              <span className="nm">Coimb. M.</span>
              <div className="lp-track"><div className="lp-fill" style={{ ["--w" as string]: "72%" }} /></div>
              <span className="amt">₹9.1 L</span>
            </div>
            <div className="lp-bar-row">
              <span className="nm">Rajkot F.</span>
              <div className="lp-track"><div className="lp-fill" style={{ ["--w" as string]: "82%" }} /></div>
              <span className="amt">₹9.4 L</span>
            </div>
            <span className="lp-stamp">✓ Best value · lowest landed cost</span>
          </div>
        </div>
      </div>

      <div className="lp-stagenav">
        {STAGES.map((s, n) => (
          <button key={s.key} className={`lp-pd${i === n ? " on" : ""}`} onClick={() => setI(n)} aria-label={`Show ${s.label}`} />
        ))}
      </div>
      <p className="lp-stagecap" dangerouslySetInnerHTML={{ __html: STAGES[i].cap }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */
const I = {
  cap: <svg viewBox="0 0 24 24" stroke="#3f4397"><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>,
  lock: <svg viewBox="0 0 24 24" stroke="#8a3a5e"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  scale: <svg viewBox="0 0 24 24" stroke="#2e7d46"><path d="M12 3v18M6 8h12M4 8l-2 6a3 3 0 0 0 6 0zM20 8l2 6a3 3 0 0 1-6 0z" /></svg>,
  chat: <svg viewBox="0 0 24 24" stroke="#128c4a"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.2-5.3A8.5 8.5 0 1 1 21 11.5z" /></svg>,
  loop: <svg viewBox="0 0 24 24" stroke="#ef7a2b"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" /></svg>,
  grid: <svg viewBox="0 0 24 24" stroke="#1e6c78"><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></svg>,
};
const tint = { cap: "rgba(63,67,151,.12)", lock: "rgba(138,58,94,.12)", scale: "rgba(46,125,70,.12)", chat: "rgba(37,211,102,.14)", loop: "rgba(239,122,43,.14)", grid: "rgba(30,108,120,.12)" } as const;

const ADV = [
  { ic: I.cap, t: tint.cap, h: "Routed to ≤5, not blasted to 500", p: "Every RFQ reaches a ranked shortlist of verified shops who genuinely make the part — no spray-and-pray listings, no broker spam." },
  { ic: I.lock, t: tint.lock, h: "Bids stay blinded", p: "Suppliers quote independently and can't see each other's pricing until you award. That keeps quotes honest and prices competitive." },
  { ic: I.scale, t: tint.scale, h: "Priced on total landed cost", p: "Unit price, tooling, freight and lead time normalised into one comparable number — so the cheapest quote isn't quietly the most expensive." },
  { ic: I.chat, t: tint.chat, h: "WhatsApp-first intake", p: "Forward the voice note, the photo, the group message. Speak in Hinglish or your vernacular — we structure it for you." },
  { ic: I.loop, t: tint.loop, h: "It asks before it routes", p: "Missing specs trigger a clarify loop back to you, so suppliers receive a complete, unambiguous requirement the first time." },
  { ic: I.grid, t: tint.grid, h: "Structured & comparable", p: "Free-text chaos becomes a clean schema you can sort, save, compare and award — with a recommendation and its rationale." },
];

const DIFF = [
  ["Supplier signal", "An open listing blasted to everyone", "≤5 ranked, capability-verified shops"],
  ["Quote basis", "Unit price — apples to oranges", "Total landed cost, normalised"],
  ["Bidder privacy", "Everyone sees everyone", "Blinded until you award"],
  ["How you submit", "Fill a long portal form", "Voice note, photo, PDF or text"],
  ["Missing details", "Chased over email for days", "Auto clarify loop before routing"],
];

/* ------------------------------------------------------------------ */
/* Landing                                                             */
/* ------------------------------------------------------------------ */
export default function Landing() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";

  return (
    <div className="lp">
      {/* NAV */}
      <nav className="lp-nav">
        <Link href="/" className="lp-logo">RFQ<b>Club</b>.</Link>
        <div className="lp-navlinks">
          <Link href="/how-it-works">How it works</Link>
          <a href="#process">The process</a>
          <a href="#why">Why RFQClub</a>
        </div>
        <span className="lp-sp" />
        <button className="lp-theme" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Toggle theme">{dark ? "☀" : "☾"}</button>
        <Link href="/login" className="lp-ghost">Sign in</Link>
        <Link href="/login?next=%2Fboard" className="lp-solid lp-lg" style={{ fontSize: 13, padding: "9px 18px" }}>Enter the board</Link>
      </nav>

      <div className="lp-wrap">
        {/* HERO */}
        <header className="lp-hero">
          <div>
            <span className="lp-eye">◇ Built for Indian manufacturing SMEs</span>
            <h1 className="lp-h1">From a WhatsApp voice note to a <em>normalised quote</em> in 48&nbsp;hours.</h1>
            <p className="lp-lead">
              RFQClub is a request-for-quote exchange for machining, foundry, sheet-metal and fabrication
              buyers. Post a requirement the way it already exists, and we structure it, route it to the few
              right suppliers, and bring their quotes back compared on <b>total landed cost</b>.
            </p>
            <div className="lp-cta">
              <Link href="/login?next=%2Fboard" className="lp-solid lp-lg">Enter the RFQ board →</Link>
              <Link href="/how-it-works" className="lp-outline lp-lg">See how it works</Link>
            </div>
            <div className="lp-trustline">
              <span className="dot" /> Verified buyers &amp; suppliers <span className="dot" /> Capped at 5 quotes <span className="dot" /> Bids blinded until award
            </div>
          </div>
          <Device />
        </header>
      </div>

      {/* PROCESS */}
      <section id="process" className="lp-section">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-kicker">
              <span className="n">01</span>
              <h2>How RFQClub works</h2>
              <span className="tag">requirement → decision</span>
            </div>
          </Reveal>
          <div className="lp-steps">
            {STAGES.map((s, n) => (
              <Reveal key={s.key} delay={n * 80}>
                <div className="lp-step">
                  <div className="node">{n + 1}</div>
                  <h4>{s.label}</h4>
                  <p dangerouslySetInnerHTML={{ __html: s.cap.replace(/<\/?b>/g, "") }} />
                  <span className="tm">{["Ingest", "Normalise", "Distribute", "Collect", "Decide"][n]}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* WHY / ADVANTAGES */}
      <section id="why" className="lp-section">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-kicker">
              <span className="n">02</span>
              <h2>Why teams choose RFQClub</h2>
              <span className="tag">the difference is in the routing</span>
            </div>
          </Reveal>
          <div className="lp-grid">
            {ADV.map((a, n) => (
              <Reveal key={a.h} delay={(n % 3) * 90}>
                <div className="lp-adv">
                  <div className="ic" style={{ background: a.t }}>{a.ic}</div>
                  <h4>{a.h}</h4>
                  <p>{a.p}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* DIFFERENTIATION */}
      <section className="lp-section">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-kicker">
              <span className="n">03</span>
              <h2>How we differ from the usual ways</h2>
              <span className="tag">vs. open listings &amp; email chains</span>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-diff">
              <div className="lp-diff-row lp-diff-head">
                <div></div>
                <div>The usual way</div>
                <div className="us">With RFQClub</div>
              </div>
              {DIFF.map((r) => (
                <div className="lp-diff-row" key={r[0]}>
                  <div><b>{r[0]}</b></div>
                  <div className="dim">{r[1]}</div>
                  <div className="us">{r[2]}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="lp-band">
        <div className="lp-wrap">
          <Reveal>
            <h2>The board is for members. Come take a look.</h2>
            <p>Sign in with a one-time email code to see live RFQs, place blinded bids, and compare quotes on total landed cost.</p>
            <Link href="/login?next=%2Fboard" className="lp-solid" style={{ fontSize: 15, padding: "13px 26px" }}>Enter the RFQ board →</Link>
          </Reveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-foot">
        <div className="lp-foot-in">
          <span className="lp-logo">RFQ<b>Club</b>.</span>
          <span>Structured for Indian SMEs — ₹ pricing, WhatsApp-first, verified hub suppliers.</span>
          <span className="lp-sp" />
          <Link href="/how-it-works">How it works</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
