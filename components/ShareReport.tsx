"use client";

import { CSSProperties, useEffect, useState } from "react";
import type { ReportModel } from "@/lib/report";
import ReportView from "./ReportView";
import { runThemeTransition } from "./Motion";

const PREFS_KEY = "jkk:prefs:v1";

// Public read-only report page wrapper. Owns theme (so the ◐ toggle works).
// Deliberately has no "back to app" navigation: this page is handed to people
// outside the app (e.g. an atasan) via /share/[token] — the journal itself sits
// behind the owner's password, so there is nowhere for them to go back to.
//
// `demo` marks the /demo page (sample data) with an explanatory banner.
export default function ShareReport({ report, demo = false }: { report: ReportModel; demo?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (prefs && (prefs.theme === "light" || prefs.theme === "dark")) {
        setTheme(prefs.theme);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = (e?: { clientX: number; clientY: number }) => {
    // Derive from current state: the reveal may apply the switch a frame later.
    runThemeTransition(e, () =>
      setTheme((t) => {
        const next = t === "dark" ? "light" : "dark";
        try {
          const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
          localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, theme: next }));
        } catch {
          /* ignore */
        }
        return next;
      }),
    );
  };

  return (
    <div data-theme={theme} style={rootStyle}>
      {demo && (
        <div className="jkk-noprint jkk-in" style={bannerStyle}>
          <span style={{ fontWeight: 700, color: "var(--accent)" }}>Contoh tampilan publik</span>
          <span>
            Data fiktif. Laporan asli dibagikan lewat tombol <b>Bagikan</b> di aplikasi dan bisa dibuka siapa pun yang memegang tautannya — hanya untuk rentang tanggal yang dipilih.
          </span>
          <a href="/login" style={{ color: "var(--accent)", fontWeight: 650, textDecoration: "none", whiteSpace: "nowrap" }}>
            Masuk ke jurnal ›
          </a>
        </div>
      )}
      <ReportView report={report} onToggleTheme={toggle} />
    </div>
  );
}

const rootStyle: CSSProperties = {
  background: "var(--bg)",
  color: "var(--text)",
  minHeight: "100dvh",
  WebkitFontSmoothing: "antialiased",
  textRendering: "optimizeLegibility",
};
const bannerStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: "4px 12px",
  padding: "10px 16px",
  background: "var(--accent-soft)",
  color: "var(--text-2)",
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: "center",
};
