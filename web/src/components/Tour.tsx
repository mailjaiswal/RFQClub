"use client";
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from "react";

type Step = { sel: string; k: string; t: string; p: string };

// Mirrors the mock's TOUR array (design-concepts.html L423-433).
const TOUR: Step[] = [
  { sel: "#t-nav", k: "The board", t: "Quick navigation", p: "Jump between All open, your own RFQs, active bids, and everything you Saved — always one click away on the left." },
  { sel: "#t-how", k: "Guide", t: "How it works", p: "One link opens the full How-it-works page — the end-to-end journey from a messy requirement to a normalised, total-landed-cost comparison." },
  { sel: "#t-post", k: "Ingest", t: "Three ways to post", p: "Buyers can fill the form, ask for a call, or simply WhatsApp the requirement — RFQClub turns it into a structured RFQ." },
  { sel: "#t-sectors", k: "Colour", t: "Filter by sector", p: "Each sector has its own colour. Tap a chip to narrow the board to only the work your shop actually makes." },
  { sel: "#appscope .ap-tag", k: "Tags", t: "Tap a tag to filter", p: "Every capability tag is also a filter — tap a process tag and the board narrows to only the RFQs that need it. A +N chip folds the extra tags away; tap it to expand." },
  { sel: "#t-bid, #appscope .ap-bid", k: "Act", t: "Submit a bid", p: "Quote with your unit price, lead time and assumptions. It lands in the buyer’s comparison sheet on total landed cost." },
  { sel: "#appscope .save", k: "Watchlist", t: "Save for later", p: "Tap the bookmark on any RFQ to keep it under “Saved” and quote when you’re ready. Saved rows turn green." },
  { sel: "#t-search", k: "Shortcut", t: "Ctrl + K to jump anywhere", p: "Press Ctrl K (or click here) to open the command palette — filter and jump straight to the board, an RFQ, the bid form, a profile or How-it-works without hunting through menus." },
  { sel: "#t-theme", k: "Appearance", t: "One-tap theme icon", p: "A single sun / moon icon in the header flips the whole interface between Light and Dark — no chunky toggle, and the left rail stays clean." },
];

export type TourHandle = { start: () => void };

const Tour = forwardRef<TourHandle>(function Tour(_props, ref) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const hlRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // Steps whose target exists on the current page; computed at start() so the
  // walkthrough and its dots can never disagree.
  const stepsRef = useRef<Step[]>(TOUR);

  const place = useCallback((index: number) => {
    const s = stepsRef.current[index];
    const el = s ? (document.querySelector(s.sel) as HTMLElement | null) : null;
    const hl = hlRef.current;
    const tip = tipRef.current;
    if (!el || !hl || !tip) { setActive(false); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => {
      const pad = 10;
      const r = el.getBoundingClientRect();
      const sc = window.scrollY, xc = window.scrollX;
      hl.style.display = "block";
      hl.style.top = `${r.top + sc - pad}px`;
      hl.style.left = `${r.left + xc - pad}px`;
      hl.style.width = `${r.width + pad * 2}px`;
      hl.style.height = `${r.height + pad * 2}px`;
      tip.style.display = "block";
      const th = tip.offsetHeight, tw = tip.offsetWidth;
      // All coordinates below are page-space; viewport bottom in page-space is sc + innerHeight.
      const vpBottom = sc + window.innerHeight - 20;
      // Prefer below the target; flip above if it would overflow the bottom;
      // if the target is too tall for either (e.g. the left rail), center in viewport.
      let tTop = r.top + sc + r.height + pad + 14;
      if (tTop + th > vpBottom) {
        const above = r.top + sc - th - pad - 14;
        tTop = above > sc + 12
          ? above
          : sc + Math.max(12, (window.innerHeight - th) / 2);
      }
      const tLeft = Math.max(12, Math.min(r.left + xc, window.innerWidth - tw - 24));
      tip.style.top = `${tTop}px`;
      tip.style.left = `${tLeft}px`;
    }, 320);
  }, []);

  const start = useCallback(() => {
    stepsRef.current = TOUR.filter((s) => !!document.querySelector(s.sel));
    setStep(0); setActive(true);
  }, []);
  useImperativeHandle(ref, () => ({ start }), [start]);

  const next = useCallback(() => {
    if (step >= stepsRef.current.length - 1) { setActive(false); return; }
    setStep((s) => s + 1);
  }, [step]);

  useEffect(() => { if (active) place(step); }, [active, step, place]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(false); };
    const onResize = () => place(step);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [active, step, place]);

  if (!active) return null;
  const steps = stepsRef.current;
  const s = steps[step] ?? steps[0];
  return (
    <>
      <div className="tour-hl" ref={hlRef} />
      <div className="tour-tip" ref={tipRef}>
        <div className="k">{s.k}</div>
        <h3>{s.t}</h3>
        <p>{s.p}</p>
        <div className="row">
          <div className="dots">
            {steps.map((_, i) => <i key={i} className={i === step ? "on" : ""} />)}
          </div>
          <button className="skip" onClick={() => setActive(false)}>Skip</button>
          <button className="nx" onClick={next}>{step === steps.length - 1 ? "Done" : "Next"}</button>
        </div>
      </div>
    </>
  );
});

export default Tour;
