"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls the server component by calling router.refresh() on an interval.
// Render it only while something is in progress (e.g. status === "analyzing").
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
