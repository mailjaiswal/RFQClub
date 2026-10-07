"use client";
/**
 * A clock-style date + time picker for follow-ups and next actions.
 *
 * The native `datetime-local` control made scheduling slower than it needed to
 * be: typing a date, then hunting through a browser chrome calendar, then
 * keyboarding a time. Here a rep taps the day, taps the hour on a dial, taps the
 * minute, done — with the common desk times one tap away.
 *
 * The dial is a ring of real <button>s (positioned with trigonometry) rather than
 * SVG path hit-testing, so clicks, focus and keyboard all come for free. Minutes
 * land on 5-minute marks; the ±1 stepper covers the cases where a callback is
 * promised at 11:42.
 */
import { useEffect, useRef, useState } from "react";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUICK_TIMES = [
  { label: "9:00 AM", h: 9, m: 0 },
  { label: "11:00 AM", h: 11, m: 0 },
  { label: "2:00 PM", h: 14, m: 0 },
  { label: "5:00 PM", h: 17, m: 0 },
];

interface Parts { y: number; mo: number; d: number; h: number; mi: number }

const clone = (p: Parts): Parts => ({ ...p });
const toParts = (d: Date): Parts =>
  ({ y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes() });
const toDate = (p: Parts) => new Date(p.y, p.mo, p.d, p.h, p.mi, 0, 0);
const startOfDay = (p: Parts) => new Date(p.y, p.mo, p.d);

/** Whole days between today and the picked day (negative = in the past). */
function dayOffset(p: Parts): number {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((startOfDay(p).getTime() - t.getTime()) / 86_400_000);
}

function dayLabel(p: Parts): string {
  const off = dayOffset(p);
  const day = startOfDay(p);
  const name = DAY_NAMES[day.getDay()];
  const date = `${MON_NAMES[p.mo]} ${p.d}`;
  if (off === 0) return `Today · ${date}`;
  if (off === 1) return `Tomorrow · ${date}`;
  if (off === -1) return `Yesterday · ${date}`;
  return `${name} · ${date}`;
}

function timeLabel(p: Parts): string {
  const ap = p.h < 12 ? "AM" : "PM";
  const h12 = p.h % 12 || 12;
  return `${h12}:${String(p.mi).padStart(2, "0")} ${ap}`;
}

/** Accept ISO / datetime-local / empty and always answer with local parts. */
function parse(value: string | null | undefined): Parts {
  if (value) {
    const d = new Date(value.length === 16 ? value + ":00" : value);
    if (!isNaN(d.getTime())) return toParts(d);
  }
  // Sensible starting point: tomorrow morning, so a stray "Set" never schedules
  // something in the past hour the rep hasn't even looked at.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toParts(d);
}

export function DateTimeField({ value, onChange, disabled, align = "left" }: {
  /** ISO string (or "") — the field is the single source of truth. */
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"hour" | "minute">("hour");
  const [p, setP] = useState<Parts>(() => parse(value));
  const box = useRef<HTMLDivElement | null>(null);

  // Re-seed from the prop when it changes underneath us (a quick-action wrote the
  // next step while the popover was closed) but never clobber an edit in flight.
  useEffect(() => {
    if (!open) setP(parse(value));
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  function shiftDays(n: number) {
    const next = clone(p);
    const d = new Date(next.y, next.mo, next.d + n);
    next.y = d.getFullYear(); next.mo = d.getMonth(); next.d = d.getDate();
    setP(next);
  }

  function commit(next: Parts) { setP(next); onChange(toDate(next).toISOString()); }

  const h12 = p.h % 12 || 12;
  const isPM = p.h >= 12;

  function pickHour(n: number) {
    const next = clone(p);
    next.h = (n % 12) + (isPM ? 12 : 0);
    setP(next);
    setPhase("minute");
  }
  function pickMinute(m: number) {
    const next = clone(p);
    next.mi = m;
    setP(next);
    commit(next);
  }
  function stepMinutes(delta: number) {
    const next = clone(p);
    const d = new Date(next.y, next.mo, next.d, next.h, next.mi + delta);
    next.h = d.getHours(); next.mi = d.getMinutes();
    setP(next); commit(next);
  }
  function toggleMeridiem() {
    const next = clone(p);
    next.h = (next.h + 12) % 24;
    setP(next); commit(next);
  }
  function applyQuick(h: number, m: number) {
    const next = clone(p);
    next.h = h; next.mi = m;
    setP(next); commit(next);
  }

  const R = 72, C = 92;
  const pos = (deg: number, r = R) => ({ left: C + r * Math.sin((deg * Math.PI) / 180), top: C - r * Math.cos((deg * Math.PI) / 180) });

  return (
    <div className="in-dt" ref={box}>
      <button type="button" className={`in-btn ${open ? "primary" : ""}`} disabled={disabled}
        onClick={() => { setOpen((o) => !o); setPhase("hour"); }}>
        <span className="ic">🕐</span>
        <span>{value ? `${dayLabel(p)} · ${timeLabel(p)}` : "Pick date & time"}</span>
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className={`in-dt-pop ${align}`}>
          <div className="in-dt-read">
            <button type="button" className={phase === "hour" ? "on" : ""} onClick={() => setPhase("hour")}>{h12}</button>
            <span>:</span>
            <button type="button" className={phase === "minute" ? "on" : ""}
              onClick={() => setPhase("minute")}>{String(p.mi).padStart(2, "0")}</button>
            <button type="button" className="ap" onClick={toggleMeridiem}>{isPM ? "PM" : "AM"}</button>
            <span className="in-right in-faint" style={{ fontSize: 11 }}>{dayLabel(p)}</span>
          </div>

          <div className="in-dt-day">
            <button type="button" className="in-btn sm" title="Previous day" onClick={() => shiftDays(-1)}>◀</button>
            <div className="chips">
              {[[0, "Today"], [1, "Tomorrow"], [2, "In 2 days"], [3, "In 3 days"], [7, "Next week"]].map(([n, lab]) => (
                <button key={String(lab)} type="button"
                  className={`in-step${dayOffset(p) === n ? " cur" : ""}`}
                  onClick={() => {
                    const next = clone(p);
                    const d = new Date(); d.setDate(d.getDate() + (n as number)); d.setHours(next.h, next.mi, 0, 0);
                    setP(toParts(d)); commit(toParts(d));
                  }}>{lab}</button>
              ))}
            </div>
            <button type="button" className="in-btn sm" title="Next day" onClick={() => shiftDays(1)}>▶</button>
            <input type="date" className="in-field" style={{ maxWidth: 150 }}
              value={`${p.y}-${String(p.mo + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`}
              onChange={(e) => {
                const d = new Date(e.target.value + "T00:00:00");
                if (isNaN(d.getTime())) return;
                const next = clone(p);
                next.y = d.getFullYear(); next.mo = d.getMonth(); next.d = d.getDate();
                setP(next); commit(next);
              }} />
          </div>

          <div className="in-clock">
            <svg viewBox="0 0 184 184" className="in-clock-ring" aria-hidden="true">
              <circle cx="92" cy="92" r="82" />
              {phase === "minute" && p.mi % 5 === 0
                ? <line x1="92" y1="92" x2={pos(p.mi * 6, R).left} y2={pos(p.mi * 6, R).top} className="hand" />
                : <line x1="92" y1="92" x2={pos(h12 * 30, R * 0.62).left} y2={pos(h12 * 30, R * 0.62).top} className="hand" />}
              <circle cx="92" cy="92" r="4" className="pivot" />
            </svg>
            {phase === "hour"
              ? Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
                  const sel = n === h12;
                  return (
                    <button key={n} type="button" className={`in-clock-btn${sel ? " sel" : ""}`}
                      style={pos(n * 30)} onClick={() => pickHour(n)} aria-label={`${n} o'clock`}>{n}</button>
                  );
                })
              : Array.from({ length: 12 }, (_, i) => i * 5).map((m) => {
                  const sel = m === p.mi;
                  return (
                    <button key={m} type="button" className={`in-clock-btn${sel ? " sel" : ""}`}
                      style={pos(m * 6)} onClick={() => pickMinute(m)} aria-label={`${m} minutes`}>
                      {String(m).padStart(2, "0")}
                    </button>
                  );
                })}
          </div>

          <div className="in-dt-fine">
            <button type="button" className="in-btn sm" onClick={() => stepMinutes(-15)}>−15m</button>
            <button type="button" className="in-btn sm" onClick={() => stepMinutes(-5)}>−5m</button>
            <button type="button" className="in-btn sm" onClick={() => stepMinutes(-1)}>−1m</button>
            <span className="in-faint" style={{ fontSize: 11.5 }}>{timeLabel(p)}</span>
            <button type="button" className="in-btn sm" onClick={() => stepMinutes(1)}>+1m</button>
            <button type="button" className="in-btn sm" onClick={() => stepMinutes(5)}>+5m</button>
            <button type="button" className="in-btn sm" onClick={() => stepMinutes(15)}>+15m</button>
          </div>

          <div className="in-dt-quick">
            {QUICK_TIMES.map((q) => (
              <button key={q.label} type="button" className={`in-step${p.h === q.h && p.mi === q.m ? " cur" : ""}`}
                onClick={() => applyQuick(q.h, q.m)}>{q.label}</button>
            ))}
          </div>

          <div className="in-dt-foot">
            <button type="button" className="in-btn sm" onClick={() => { onChange(null); setOpen(false); }}>Clear</button>
            <button type="button" className="in-btn sm primary" onClick={() => { commit(p); setOpen(false); }}>
              Set {timeLabel(p)}</button>
          </div>
        </div>
      )}
    </div>
  );
}
