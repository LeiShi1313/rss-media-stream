import type { ReactNode } from "react";
import { AppDialog } from "../ui/index.js";

export function Metric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Panel({
  title,
  icon,
  actions,
  children
}: {
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header>
        <h3>{icon}{title}</h3>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <AppDialog description={title} title={title} onClose={onClose}>
      {children}
    </AppDialog>
  );
}

