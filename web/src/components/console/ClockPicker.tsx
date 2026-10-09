"use client";
/**
 * Modern Day & Time Picker for Inside-Sales Follow-ups and Next Actions.
 *
 * Redesigned from the ground up:
 * 1. Clean, structured day preset cards showing actual weekdays and dates (Today, Tomorrow, +2 Days, +3 Days, Next Week).
 * 2. Dedicated calendar date picker with single-click prev/next day navigation.
 * 3. Quick business-hour meeting slots (10:00 AM, 11:30 AM, 2:00 PM, 3:30 PM, 5:00 PM).
 * 4. Crisp digital time adjuster with direct hour/minute chips and AM/PM segmented switch.
 * 5. High-visibility summary card and clear confirmation button.
 */
import { useEffect, useRef, useState } from "react";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const QUICK_TIME_SLOTS = [
  { label: "10:00 AM", h: 10, m: 0 },
  { label: "11:30 AM", h: 11, m: 30 },
  { label: "2:00 PM", h: 14, m: 0 },
  { label: "3:30 PM", h: 15, m: 30 },
  { label: "5:00 PM", h: 17, m: 0 },
];

const ALL_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTE_STEPS = [0, 15, 30, 45];

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

const clone = (p: Parts): Parts => ({ ...p });

const toParts = (d: Date): Parts => ({
  y: d.getFullYear(),
  mo: d.getMonth(),
  d: d.getDate(),
  h: d.getHours(),
  mi: d.getMinutes(),
});

const toDate = (p: Parts): Date => new Date(p.y, p.mo, p.d, p.h, p.mi, 0, 0);

const startOfDay = (p: Parts): Date => new Date(p.y, p.mo, p.d);

/** Whole days between today and the picked day (0 = today, 1 = tomorrow, etc.) */
function dayOffset(p: Parts): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const picked = startOfDay(p);
  return Math.round((picked.getTime() - t.getTime()) / 86_400_000);
}

function formatDayLabel(p: Parts): string {
  const off = dayOffset(p);
  const day = startOfDay(p);
  const dayName = DAY_NAMES[day.getDay()];
  const dateStr = `${MON_NAMES[p.mo]} ${p.d}`;
  if (off === 0) return `Today (${dateStr})`;
  if (off === 1) return `Tomorrow (${dateStr})`;
  if (off === -1) return `Yesterday (${dateStr})`;
  return `${dayName}, ${dateStr}`;
}

function formatFullSummary(p: Parts): string {
  const day = startOfDay(p);
  const dayName = DAY_NAMES[day.getDay()];
  const dateStr = `${dayName}, ${MON_NAMES[p.mo]} ${p.d}, ${p.y}`;
  const ap = p.h < 12 ? "AM" : "PM";
  const h12 = p.h % 12 || 12;
  const timeStr = `${h12}:${String(p.mi).padStart(2, "0")} ${ap}`;
  return `${dateStr} at ${timeStr}`;
}

function formatTime(p: Parts): string {
  const ap = p.h < 12 ? "AM" : "PM";
  const h12 = p.h % 12 || 12;
  return `${h12}:${String(p.mi).padStart(2, "0")} ${ap}`;
}

function parse(value: string | null | undefined): Parts {
  if (value) {
    const d = new Date(value.length === 16 ? value + ":00" : value);
    if (!isNaN(d.getTime())) return toParts(d);
  }
  // Sensible default: tomorrow at 11:00 AM
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return toParts(d);
}

export function DateTimeField({
  value,
  onChange,
  disabled,
  align = "left",
}: {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Parts>(() => parse(value));
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) setP(parse(value));
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function shiftDays(n: number) {
    const next = clone(p);
    const d = new Date(next.y, next.mo, next.d + n);
    next.y = d.getFullYear();
    next.mo = d.getMonth();
    next.d = d.getDate();
    setP(next);
    commit(next);
  }

  function setPresetDay(daysFromToday: number) {
    const next = clone(p);
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    next.y = d.getFullYear();
    next.mo = d.getMonth();
    next.d = d.getDate();
    setP(next);
    commit(next);
  }

  function commit(next: Parts) {
    setP(next);
    onChange(toDate(next).toISOString());
  }

  const h12 = p.h % 12 || 12;
  const isPM = p.h >= 12;

  function setHour(h: number) {
    const next = clone(p);
    next.h = (h % 12) + (isPM ? 12 : 0);
    setP(next);
    commit(next);
  }

  function setMinute(m: number) {
    const next = clone(p);
    next.mi = m;
    setP(next);
    commit(next);
  }

  function toggleMeridiem(targetPM: boolean) {
    if (isPM === targetPM) return;
    const next = clone(p);
    next.h = targetPM ? (next.h % 12) + 12 : next.h % 12;
    setP(next);
    commit(next);
  }

  function stepMinutes(delta: number) {
    const next = clone(p);
    const d = new Date(next.y, next.mo, next.d, next.h, next.mi + delta);
    next.y = d.getFullYear();
    next.mo = d.getMonth();
    next.d = d.getDate();
    next.h = d.getHours();
    next.mi = d.getMinutes();
    setP(next);
    commit(next);
  }

  function applyQuickSlot(h: number, m: number) {
    const next = clone(p);
    next.h = h;
    next.mi = m;
    setP(next);
    commit(next);
  }

  // Pre-calculate preset card labels
  const offset = dayOffset(p);
  const now = new Date();
  const presets = [
    { offset: 0, title: "Today", sub: `${DAY_NAMES[now.getDay()]} ${now.getDate()}` },
    {
      offset: 1,
      title: "Tomorrow",
      sub: (() => {
        const d = new Date(); d.setDate(d.getDate() + 1);
        return `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
      })(),
    },
    {
      offset: 2,
      title: "+2 Days",
      sub: (() => {
        const d = new Date(); d.setDate(d.getDate() + 2);
        return `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
      })(),
    },
    {
      offset: 3,
      title: "+3 Days",
      sub: (() => {
        const d = new Date(); d.setDate(d.getDate() + 3);
        return `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
      })(),
    },
    {
      offset: 7,
      title: "+1 Week",
      sub: (() => {
        const d = new Date(); d.setDate(d.getDate() + 7);
        return `${MON_NAMES[d.getMonth()]} ${d.getDate()}`;
      })(),
    },
  ];

  return (
    <div className="in-dt" ref={box}>
      <button
        type="button"
        className={`in-btn ${open ? "primary" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ic">📅</span>
        <span>
          {value ? `${formatDayLabel(p)} · ${formatTime(p)}` : "Pick date & time"}
        </span>
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className={`in-dt-pop in-picker-redesign ${align}`}>
          {/* Header Live Preview Banner */}
          <div className="in-dt-summary-banner">
            <div className="in-dt-summary-icon">⏰</div>
            <div className="in-dt-summary-body">
              <div className="in-dt-summary-title">{formatFullSummary(p)}</div>
              <div className="in-dt-summary-sub">
                {offset === 0 ? "Scheduled for Today" : offset > 0 ? `In ${offset} day${offset > 1 ? "s" : ""}` : "Past date"}
              </div>
            </div>
          </div>

          {/* Section 1: Day Presets */}
          <div className="in-dt-sec">
            <div className="in-dt-sec-hdr">
              <span>Quick Day Select</span>
            </div>
            <div className="in-dt-presets-grid">
              {presets.map((pr) => {
                const active = offset === pr.offset;
                return (
                  <button
                    key={pr.offset}
                    type="button"
                    className={`in-dt-preset-card ${active ? "active" : ""}`}
                    onClick={() => setPresetDay(pr.offset)}
                  >
                    <span className="pr-title">{pr.title}</span>
                    <span className="pr-sub">{pr.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Picker Row with Steppers */}
          <div className="in-dt-date-row">
            <button
              type="button"
              className="in-btn sm in-dt-nav-btn"
              title="Previous day"
              onClick={() => shiftDays(-1)}
            >
              ◀
            </button>
            <input
              type="date"
              className="in-field in-dt-date-input"
              value={`${p.y}-${String(p.mo + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`}
              onChange={(e) => {
                const d = new Date(e.target.value + "T00:00:00");
                if (isNaN(d.getTime())) return;
                const next = clone(p);
                next.y = d.getFullYear();
                next.mo = d.getMonth();
                next.d = d.getDate();
                setP(next);
                commit(next);
              }}
            />
            <button
              type="button"
              className="in-btn sm in-dt-nav-btn"
              title="Next day"
              onClick={() => shiftDays(1)}
            >
              ▶
            </button>
          </div>

          {/* Section 2: Business Hours Quick Slots */}
          <div className="in-dt-sec">
            <div className="in-dt-sec-hdr">
              <span>Desk Times</span>
            </div>
            <div className="in-dt-slots-grid">
              {QUICK_TIME_SLOTS.map((slot) => {
                const isSelected = p.h === slot.h && p.mi === slot.m;
                return (
                  <button
                    key={slot.label}
                    type="button"
                    className={`in-dt-slot-pill ${isSelected ? "active" : ""}`}
                    onClick={() => applyQuickSlot(slot.h, slot.m)}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Precision Digital Adjuster */}
          <div className="in-dt-sec">
            <div className="in-dt-sec-hdr">
              <span>Time Adjuster</span>
              <div className="in-dt-ampm-switch">
                <button
                  type="button"
                  className={`in-dt-ampm-btn ${!isPM ? "active" : ""}`}
                  onClick={() => toggleMeridiem(false)}
                >
                  AM
                </button>
                <button
                  type="button"
                  className={`in-dt-ampm-btn ${isPM ? "active" : ""}`}
                  onClick={() => toggleMeridiem(true)}
                >
                  PM
                </button>
              </div>
            </div>

            {/* Hours Chips */}
            <div className="in-dt-chips-label">Hour</div>
            <div className="in-dt-hours-row">
              {ALL_HOURS.map((hr) => {
                const isSel = h12 === hr;
                return (
                  <button
                    key={hr}
                    type="button"
                    className={`in-dt-chip ${isSel ? "active" : ""}`}
                    onClick={() => setHour(hr)}
                  >
                    {hr}
                  </button>
                );
              })}
            </div>

            {/* Minutes Chips & Fine Adjust */}
            <div className="in-dt-chips-label" style={{ marginTop: 6 }}>
              <span>Minute</span>
              <span className="in-faint" style={{ fontWeight: "normal", fontSize: 11 }}>
                Current: {String(p.mi).padStart(2, "0")}m
              </span>
            </div>
            <div className="in-dt-minutes-row">
              {MINUTE_STEPS.map((min) => {
                const isSel = p.mi === min;
                return (
                  <button
                    key={min}
                    type="button"
                    className={`in-dt-chip ${isSel ? "active" : ""}`}
                    onClick={() => setMinute(min)}
                  >
                    :{String(min).padStart(2, "0")}
                  </button>
                );
              })}
              <button
                type="button"
                className="in-btn sm in-dt-fine-btn"
                title="Subtract 15 mins"
                onClick={() => stepMinutes(-15)}
              >
                -15m
              </button>
              <button
                type="button"
                className="in-btn sm in-dt-fine-btn"
                title="Add 15 mins"
                onClick={() => stepMinutes(15)}
              >
                +15m
              </button>
            </div>
          </div>

          {/* Action Footer */}
          <div className="in-dt-foot">
            <button
              type="button"
              className="in-btn sm in-dt-clear-btn"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear Schedule
            </button>
            <button
              type="button"
              className="in-btn sm primary in-dt-set-btn"
              onClick={() => {
                commit(p);
                setOpen(false);
              }}
            >
              ✓ Set for {formatTime(p)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
