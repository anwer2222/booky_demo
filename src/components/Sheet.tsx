"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props<T extends string> = {
  title: string;
  subtitle?: string;
  tabs?: [T, string][];
  tab?: T;
  onTab?: (t: T) => void;
  onClose: () => void;
  children: ReactNode;
};

/** Modal panel used by "my books", story options and the info panel. Escape or the backdrop closes it. */
export default function Sheet<T extends string>({ title, subtitle, tabs, tab, onTab, onClose, children }: Props<T>) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="lib-backdrop" onClick={onClose}>
      <div
        className="lib"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialog}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <header className="lib-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        {subtitle && <p className="lib-sub">{subtitle}</p>}
        {tabs && (
          <nav className="lib-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => onTab?.(id)}>
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className="lib-body">{children}</div>
      </div>
    </div>
  );
}
