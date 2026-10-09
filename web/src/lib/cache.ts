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
const STORAGE_PREFIX = "rfq_cache_v2:";

function storageKey(key: string) { return STORAGE_PREFIX + key; }

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const testKey = "__rc_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
}

/** Restore persisted keys once per session/tab with real timestamp. */
function hydrate(key: string): Entry | undefined {
  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(storageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const entry: Entry = {
      data: parsed.data !== undefined ? parsed.data : parsed,
      ts: typeof parsed.ts === "number" ? parsed.ts : 0,
      persist: true,
    };
    store.set(key, entry);
    return entry;
  } catch {
    return undefined;
  }
}

export function peek<T>(key: string): T | undefined {
  const hit = store.get(key) ?? hydrate(key);
  return hit ? (hit.data as T) : undefined;
}

function ageMs(key: string): number {
  const hit = store.get(key) ?? hydrate(key);
  return hit ? Math.max(0, Date.now() - hit.ts) : Infinity;
}

/** How old the cached copy of `key` is (Infinity when nothing is stored). */
export const ageOf = ageMs;

const MAX_STORE_ENTRIES = 180;

function notify(key: string, data: unknown) {
  subs.get(key)?.forEach((fn) => { try { fn(data); } catch { /* component unmounted */ } });
}

function pruneStorage(storage: Storage) {
  try {
    const keys: { k: string; ts: number }[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) {
        try {
          const raw = storage.getItem(k);
          const parsed = raw ? JSON.parse(raw) : null;
          keys.push({ k, ts: parsed?.ts || 0 });
        } catch {
          keys.push({ k, ts: 0 });
        }
      }
    }
    if (keys.length > MAX_STORE_ENTRIES) {
      keys.sort((a, b) => a.ts - b.ts);
      const toRemove = keys.slice(0, keys.length - MAX_STORE_ENTRIES + 20);
      for (const item of toRemove) {
        storage.removeItem(item.k);
      }
    }
  } catch {
    /* ignore prune errors */
  }
}

export function put(key: string, data: unknown, persist = true) {
  if (store.size >= MAX_STORE_ENTRIES && !store.has(key)) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of store.entries()) {
      if (!v.persist && v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      store.delete(oldestKey);
    }
  }

  const now = Date.now();
  store.set(key, { data, ts: now, persist });

  if (persist) {
    const storage = getStorage();
    if (storage) {
      try {
        storage.setItem(storageKey(key), JSON.stringify({ data, ts: now }));
      } catch {
        pruneStorage(storage);
        try {
          storage.setItem(storageKey(key), JSON.stringify({ data, ts: now }));
        } catch {
          /* quota strictly exceeded, in-memory remains authoritative */
        }
      }
    }
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
  const storage = getStorage();
  if (storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX + prefix)) {
          const raw = storage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            parsed.ts = 0;
            storage.setItem(k, JSON.stringify(parsed));
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export function cacheKeys(prefix: string): string[] {
  return [...store.keys()].filter((k) => k.startsWith(prefix));
}

/** Fetch (or reuse an in-flight fetch) and publish into the cache. */
export function refresh<T>(key: string, fetcher: () => Promise<T>, opts: { persist?: boolean } = {}): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const shouldPersist = opts.persist !== false;
  const p = fetcher()
    .then((data) => { put(key, data, shouldPersist); return data; })
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
 * Read `key` from cache immediately (0ms paint), then revalidate in the background
 * if stale or older than maxAgeMs.
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
  const maxAge = opts.maxAgeMs ?? 30_000;

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

    const isStale = hit === undefined || ageMs(key) > maxAge;
    if (isStale) {
      refresh(key, () => fetcherRef.current(), { persist: optsRef.current.persist !== false })
        .then(() => { if (alive) setPending(false); })
        .catch((e) => { if (alive) setError(String((e as Error)?.message || e)); });
    }
    return () => { alive = false; set.delete(sub); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, maxAge]);

  const revalidate = useCallback(() => {
    if (!enabled) return;
    refresh(key, () => fetcherRef.current(), { persist: optsRef.current.persist !== false })
      .catch((e) => setError(String((e as Error)?.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { data, error, pending, revalidate };
}
