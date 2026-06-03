import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}

export function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={ok ? "status-pill ok" : "status-pill warn"}>{children}</span>;
}

export function Empty({ label }: { label: string }) {
  return <p className="empty">{label}</p>;
}

