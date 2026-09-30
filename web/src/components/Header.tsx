"use client";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import { useCommand } from "@/components/CommandPalette";

export default function Header() {
  const { open } = useCommand();
  return (
    <header
      className="sticky top-0 z-40"
      style={{ background: "var(--paper)", borderBottom: "1px solid var(--hairline)" }}
    >
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-4">
        <Link href="/" className="display font-semibold flex items-center gap-2" style={{ fontSize: 19, letterSpacing: "-0.5px" }}>
          <span
            className="mono"
            style={{ background: "var(--primary)", color: "#fff", borderRadius: 7, padding: "2px 7px", fontSize: 12 }}
          >
            RFQ
          </span>
          Club
        </Link>

        <nav className="hidden sm:flex items-center gap-4 ml-2" style={{ color: "var(--subtle)", fontSize: 13 }}>
          <Link href="/" className="hover:opacity-70">Board</Link>
          <Link href="/how-it-works" className="hover:opacity-70">How it works</Link>
        </nav>

        <button
          onClick={open}
          className="ap-search ml-auto flex items-center gap-2"
          style={{
            border: "1px solid var(--hairline)", background: "var(--card)", borderRadius: 10,
            padding: "7px 12px", color: "var(--muted)", fontSize: 12.5, cursor: "pointer", minWidth: 180,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
          </svg>
          Search / jump…
          <kbd style={{ marginLeft: "auto" }}>⌘K</kbd>
        </button>

        <ThemeToggle />
      </div>
    </header>
  );
}
