"use client";
/**
 * A ~100-line stale-while-revalidate cache for the console.
 *
 * The hosted API answers in ~1-2s, so the old "fetch on every mount, render
 * nothing until it lands" pattern made every click feel slow — and repeated the
 * same round-trip when the user bounced from queue → lead → queue. This module
 * keeps the last response per key in memory (and sessionStorage for stable
 * reference data) so a screen paints instantly from cache while a background
 * revalidate corrects it a moment later.
 *
 * Three primitives matter for the write path:
 *   markStale  — "the world changed", so the next mount must revalidate
 *   patch      — write-through a known change (e.g. a new owner) so the cached
 *                screen is correct *and* instant, without waiting on the server
 *   drop       — remove a row from cached lists when it leaves that view
 * Both push updates to already-mounted subscribers, so a mutation on one screen
 * visibly updates another without a refetch.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Entry { data: unknown; ts: number; persist: boolean }

const store = new Map<string, Entry>();
const subs = new Map<string, Set<(data: unknown) => void>>();
const inflight = new Map<string, Promise<unknown>>();
const SS_PREFIX = "rfqclub_cache:";

function ssKey(key: string) { return SS_PREFIX + key; }

/** Restore sessionStorage-persisted keys once (per tab, per load). */
function hydrate(key: string): Entry | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(ssKey(key));
    if (!raw) return undefined;
    const entry: Entry = { data: JSON.parse(raw), ts: 0, persist: true };
    store.set(key, entry);
    return entry;
  } catch { return undefined; }
}

export function peek<T>(key: string): T | undefined {
  const hit = store.get(key) ?? hydrate(key);
  return hit ? (hit.data as T) : undefined;
}

function ageMs(key: string): number {
  const hit = store.get(key);
  return hit ? Date.now() - hit.ts : Infinity;
}

/** How old the cached copy of `key` is (Infinity when nothing is stored). */
export const ageOf = ageMs;

function notify(key: string, data: unknown) {
  subs.get(key)?.forEach((fn) => { try { fn(data); } catch { /* component unmounted */ } });
}

export function put(key: string, data: unknown, persist = false) {
  store.set(key, { data, ts: Date.now(), persist });
  if (persist && typeof window !== "undefined") {
    try { sessionStorage.setItem(ssKey(key), JSON.stringify(data)); } catch { /* quota */ }
  }
  notify(key, data);
}

/**
 * Change a cached value in place (write-through). Returns whether a cached copy
 * existed — a cold cache is left alone rather than fabricating a warm one.
 */
export function patch<T>(key: string, updater: (cur: T) => T): boolean {
  const hit = store.get(key) ?? hydrate(key);
  if (!hit) return false;
  const next = updater(hit.data as T);
  put(key, next, hit.persist);
  return true;
}

/** Mark every cached key under a prefix as in need of revalidation. */
export function markStale(prefix: string) {
  for (const [key, entry] of store.entries()) {
    if (key.startsWith(prefix)) entry.ts = 0;
  }
}

export function cacheKeys(prefix: string): string[] {
  return [...store.keys()].filter((k) => k.startsWith(prefix));
}

/** Fetch (or reuse an in-flight fetch) and publish into the cache. */
export function refresh<T>(key: string, fetcher: () => Promise<T>, opts: { persist?: boolean } = {}): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fetcher()
    .then((data) => { put(key, data, !!opts.persist); return data; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export interface Cached<T> {
  data: T | undefined;
  error: string;
  /** true only while there is nothing cached to show yet */
  pending: boolean;
  revalidate: () => void;
}

/**
 * Read `key` from cache immediately, then revalidate in the background.
 * `fetcher` may change identity freely — only `key` drives the effect.
 */
export function useCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { persist?: boolean; maxAgeMs?: number; enabled?: boolean } = {},
): Cached<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const enabled = opts.enabled !== false;

  const [data, setData] = useState<T | undefined>(() => (enabled ? peek<T>(key) : undefined));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(() => enabled && peek<T>(key) === undefined);

  useEffect(() => {
    if (!enabled) { setData(undefined); setPending(false); return; }
    let alive = true;
    const hit = peek<T>(key);
    setData(hit);
    setPending(hit === undefined);
    setError("");

    const sub = (d: unknown) => { if (alive) { setData(d as T); setPending(false); } };
    let set = subs.get(key);
    if (!set) subs.set(key, (set = new Set()));
    set.add(sub);

    if (hit === undefined || ageMs(key) > (opts.maxAgeMs ?? 0)) {
      refresh(key, () => fetcherRef.current(), optsRef.current)
        .catch((e) => { if (alive) setError(String((e as Error)?.message || e)); });
    }
    return () => { alive = false; set.delete(sub); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const revalidate = useCallback(() => {
    if (!enabled) return;
    refresh(key, () => fetcherRef.current(), optsRef.current)
      .catch((e) => setError(String((e as Error)?.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { data, error, pending, revalidate };
}
