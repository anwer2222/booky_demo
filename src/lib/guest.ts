"use client";

import { useCallback, useEffect, useState } from "react";

// Stories sent without an account: each has a secret token, kept in this browser so the shelf can
// show the family's books. Signing up later with the same email links them to the account for good.

const KEY = "story-shelf-guest";
const EVENT = "guest-tokens";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function addGuestToken(token: string) {
  try {
    const all = read();
    if (!all.includes(token)) localStorage.setItem(KEY, JSON.stringify([...all, token].slice(-20)));
  } catch { /* storage blocked: the book shows after signing up with the same email */ }
  window.dispatchEvent(new Event(EVENT));
}

/** This browser's guest tokens, updated when a new story is sent. */
export function useGuestTokens() {
  const [tokens, setTokens] = useState<string[]>([]);
  const sync = useCallback(() => setTokens(read()), []);
  useEffect(() => {
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [sync]);
  return tokens;
}
