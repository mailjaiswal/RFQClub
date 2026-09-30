"use client";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useCommand } from "@/components/CommandPalette";
import Tour, { type TourHandle } from "@/components/Tour";

const SUN = <svg className="ic-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const MOON = <svg className="ic-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;

type View = "all" | "saved" | "myrfqs" | "mybids";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedTheme, setTheme } = useTheme();
  const cmd = useCommand();
  const tourRef = useRef<TourHandle>(null);

  const [mounted, setMounted] = useState(false);
  const [counts, setCounts] = useState({ open: 0, saved: 0 });
  useEffect(() => setMounted(true), []);

  // Board publishes live counts (open + saved) whenever they change. The board
  // child effect runs before this parent mounts its listener, so prime from the
  // value the board stashed on the window, then keep in sync via the event.
  useEffect(() => {
    const stored = (window as unknown as { __apCounts?: { open: number; saved: number } }).__apCounts;
    if (stored) setCounts(stored);
    const on = (e: Event) => setCounts((e as CustomEvent).detail);
    window.addEventListener("ap:counts", on);
    return () => window.removeEventListener("ap:counts", on);
  }, []);

  const view = (searchParams.get("view") as View) || "all";
  const onBoard = pathname === "/";
  const dark = mounted && resolvedTheme === "dark";

  function goView(v: View) {
    router.push(v === "all" ? "/" : `/?view=${v}`);
  }

  return (
    <div className={`app${dark ? " dark" : ""}`} id="appscope">
      {/* TOP BAR */}
      <div className="ap-top">
        <span className="ap-mark">RFQ<b>Club</b>.</span>
        <div className="ap-search mono" id="t-search" onClick={cmd.open} title="Search or jump to a screen (Ctrl K)">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          Search or jump to…
          <kbd>Ctrl K</kbd>
        </div>
        <div className="ap-right">
          <button className="ap-tour" onClick={() => tourRef.current?.start()}>◉ Take a tour</button>
          <button className="ap-icbtn" id="t-theme" title="Toggle light / dark theme" aria-label="Toggle theme"
            onClick={() => setTheme(dark ? "light" : "dark")}>
            {SUN}{MOON}
          </button>
          <Link className="ap-post" href="/how-it-works">Post an RFQ</Link>
        </div>
      </div>

      <div className="ap-body">
        {/* LEFT RAIL */}
        <aside className="ap-left" id="t-nav">
          <div className="ap-scroll">
            <div className="ap-lbl">Board</div>
            <div className="ap-nav">
              <button className={onBoard && view === "all" ? "on" : ""} onClick={() => goView("all")}>
                <svg viewBox="0 0 24 24"><path d="M3 5h18M3 12h18M3 19h18" /></svg>All open
                <span className="cnt">{counts.open}</span>
              </button>
              <Link href="/my-rfqs" className={pathname === "/my-rfqs" ? "on" : ""}>
                <svg viewBox="0 0 24 24"><path d="M14 3v5h5M6 3h9l5 5v13H6z" /></svg>My RFQs
              </Link>
              <button className={onBoard && view === "mybids" ? "on" : ""} onClick={() => goView("mybids")}>
                <svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>My bids
              </button>
              <button className={onBoard && view === "saved" ? "on" : ""} onClick={() => goView("saved")}>
                <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z" /></svg>Saved
                <span className="cnt">{counts.saved}</span>
              </button>
            </div>

            <div className="ap-lbl grp">Learn</div>
            <div className="ap-nav">
              <Link href="/how-it-works" id="t-how">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11.5v4.5M12 8h.01" /></svg>How it works
              </Link>
              <Link href="/profile">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></svg>My profile
              </Link>
            </div>

            <div className="ap-postblk" id="t-post">
              <h4>How to post</h4>
              <div className="ap-po">
                <span className="l"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Post an RFQ</span>
                <Link className="c" href="/how-it-works">Open form →</Link>
              </div>
              <div className="ap-po">
                <span className="l"><svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" /></svg>Speak to us</span>
                <Link className="c" href="/how-it-works">Request a call</Link>
              </div>
              <div className="ap-po">
                <span className="l"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.2-5.3A8.5 8.5 0 1 1 21 11.5z" /></svg>WhatsApp the requirement</span>
                <a className="c wa" href="https://wa.me/910000000000" target="_blank" rel="noopener">WhatsApp</a>
              </div>
            </div>

            <div className="ap-verify">
              <b>Verified buyers only.</b> Every RFQ comes from a real manufacturing business — no brokers, no spam, capped at 5 qualified suppliers.
            </div>
          </div>

          <div className="ap-user">
            <Link className="ap-userrow" href="/profile" title="Open my profile">
              <span className="ap-ava">A</span>
              <span className="ap-una"><b>Ankur</b><span>Admin · RFQClub</span></span>
              <span className="ap-ugear" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z" /></svg></span>
            </Link>
            <button className="ap-out" onClick={() => router.push("/")} title="Log out">Log out</button>
          </div>
        </aside>

        {/* CENTER */}
        <main className="ap-main">{children}</main>
      </div>

      <Tour ref={tourRef} />
    </div>
  );
}
