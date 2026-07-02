"use client";

import { CSSProperties, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportModel } from "@/lib/report";
import ReportView from "./ReportView";

const PREFS_KEY = "jkk:prefs:v1";

// Public read-only report page wrapper. Owns theme (so the ◐ toggle works) and a
// back button that returns to the app home.
export default function ShareReport({ report }: { report: ReportModel }) {
  const router = useRouter();
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
      <ReportView
        report={report}
        onToggleTheme={toggle}
        onBack={() => router.push("/")}
        backLabel="‹ Aplikasi"
      />
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
