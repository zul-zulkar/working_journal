"use client";

import { CSSProperties, useEffect, useState } from "react";
import type { ReportModel } from "@/lib/report";
import ReportView from "./ReportView";

const PREFS_KEY = "jkk:prefs:v1";

// Public read-only report page wrapper. Owns theme (so the ◐ toggle works).
// Deliberately has no "back to app" navigation: this page is handed to people
// outside the app (e.g. an atasan) via /share/[token], and the main app has no
// login — routing them into it would expose every activity, not just this
// report's date range.
export default function ShareReport({ report }: { report: ReportModel }) {
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

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, theme: next }));
    } catch {
      /* ignore */
    }
  };

  return (
    <div data-theme={theme} style={rootStyle}>
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
