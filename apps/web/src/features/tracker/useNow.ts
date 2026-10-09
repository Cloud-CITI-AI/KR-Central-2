"use client";
import { useEffect, useState } from "react";

/**
 * The current time as a `Date`, refreshed every `intervalMs`. This is the injected clock of the tracker's date rules
 * (`approvalExpiryStatus`, `outcomeCountdown`): components pass it down instead of reading the time themselves.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
