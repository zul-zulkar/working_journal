"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category } from "@/lib/types";

// Searchable select for choosing a Rencana Kinerja (category) in the editor.
// Rendered in normal flow (the list grows the modal body) so it is never clipped
// by the modal's overflow:auto, and works well on mobile.
//
// `categories` is the list AVAILABLE for the activity's date (already filtered by
// the caller). `allCategories` resolves the selected label even when the current
// value falls outside that date's period (e.g. editing an older activity).
export default function CategorySelect({
  categories,
  value,
  onChange,
  allCategories,
  emptyHint,
  outOfRangeNote,
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  allCategories?: Category[];
  emptyHint?: string;
  /** Replaces the default out-of-range warning (e.g. when the date is still blank). */
  outOfRangeNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolveList = allCategories && allCategories.length ? allCategories : categories;
  const selected = resolveList.find((c) => c.id === value) || null;
  // The chosen Rencana Kinerja is set but not valid for the current date range.
  const outOfRange = !!selected && !categories.some((c) => c.id === selected.id);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHi(0);
      // Focus the search field once the list is mounted.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => setHi(0), [query]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[hi]) pick(filtered[hi].id);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            padding: "10px 12px",
            borderRadius: 11,
            border: "1px solid var(--sep-2)",
            background: "var(--bg)",
            color: selected ? "var(--text)" : "var(--text-3)",
            fontSize: 14,
            fontWeight: selected ? 600 : 500,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {selected && (
            <span style={{ width: 10, height: 10, borderRadius: 3, flex: "none", marginTop: 4, background: selected.color }} />
          )}
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.35, overflowWrap: "break-word" }}>
            {selected ? selected.name : "Pilih rencana kinerja…"}
          </span>
          <span style={{ color: "var(--text-3)", fontSize: 12, flex: "none", marginTop: 2 }}>▾</span>
        </button>
      ) : null}
      {!open && outOfRange && (
        <div style={{ marginTop: 6, fontSize: 12, color: outOfRangeNote ? "var(--text-3)" : "#FF9F0A", lineHeight: 1.4 }}>
          {outOfRangeNote ||
            "⚠︎ Rencana kinerja ini di luar periode tanggal kegiatan. Ubah tanggal atau pilih rencana kinerja lain."}
        </div>
      )}
      {open && (
        <div
          style={{
            border: "1.5px solid var(--accent)",
            borderRadius: 11,
            background: "var(--surface)",
            overflow: "hidden",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Cari rencana kinerja…"
            style={{
              width: "100%",
              padding: "11px 12px",
              border: "none",
              borderBottom: "1px solid var(--sep)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ maxHeight: 220, overflow: "auto", padding: 5 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px 10px", fontSize: 13.5, color: "var(--text-3)", lineHeight: 1.5 }}>
                {categories.length === 0
                  ? emptyHint ||
                    "Tidak ada rencana kinerja untuk tanggal ini. Buat periode & tetapkan rencana kinerja di halaman Kelola."
                  : "Tidak ada rencana kinerja yang cocok."}
              </div>
            ) : (
              filtered.map((c, i) => {
                const active = c.id === value;
                const hilite = i === hi;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(c.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 9,
                      padding: "9px 10px",
                      borderRadius: 8,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      textAlign: "left",
                      color: active ? "var(--accent)" : "var(--text)",
                      fontWeight: active ? 640 : 500,
                      background: hilite ? "var(--fill)" : "transparent",
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 3, flex: "none", marginTop: 4, background: c.color }} />
                    <span style={{ flex: 1, lineHeight: 1.35, overflowWrap: "break-word" }}>{c.name}</span>
                    {active && <span style={{ color: "var(--accent)", fontSize: 13, flex: "none", marginTop: 2 }}>✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
