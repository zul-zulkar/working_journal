"use client";

import { CSSProperties, FormEvent, useEffect, useRef, useState } from "react";

const PREFS_KEY = "jkk:prefs:v1";

// Owner sign-in. Visual language follows the app's modal cards (same tokens,
// radii and buttons) — this is the only screen a stranger without a share link
// ever sees.
export default function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (prefs && (prefs.theme === "light" || prefs.theme === "dark")) setTheme(prefs.theme);
    } catch {
      /* ignore */
    }
  }, []);

  const shake = () => {
    const el = fieldRef.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-9px)" },
        { transform: "translateX(8px)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(3px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 440, easing: "cubic-bezier(.36,.07,.19,.97)" },
    );
  };

  const fail = (msg: string) => {
    setBusy(false);
    setError(msg);
    shake();
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    if (!password) return fail("Masukkan kata sandi.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return fail(j.error || "Gagal masuk. Coba lagi.");
      setDone(true);
      // Let the card finish its exit before the app takes over.
      setTimeout(() => window.location.replace(next), 420);
    } catch {
      fail("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
    }
  };

  return (
    <div data-theme={theme} style={rootStyle}>
      <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", gap: 22 }}>
        <div className={done ? "jkk-login-card jkk-login-out" : "jkk-login-card"} style={cardStyle}>
          <div style={logoBox}>J</div>
          <h1 style={{ margin: "16px 0 4px", fontSize: 22, fontWeight: 740, letterSpacing: "-.025em", textAlign: "center" }}>Jurnal Kegiatan</h1>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--text-2)", textAlign: "center", lineHeight: 1.5 }}>
            Bukti Dukung SKP · masukkan kata sandi untuk membuka jurnal.
          </p>

          {!configured && (
            <div className="jkk-in" style={{ ...noteStyle, background: "rgba(255,159,10,.12)", color: "#C77700" }}>
              Server belum dikonfigurasi: atur <b>APP_PASSWORD</b> pada environment variable, lalu deploy ulang.
            </div>
          )}

          <form onSubmit={submit} noValidate>
            {/* Lets password managers file the credential under one fixed name. */}
            <input type="text" name="username" autoComplete="username" value="jurnal-kegiatan" readOnly hidden />
            <label htmlFor="jkk-password" style={{ display: "block", fontSize: 13, fontWeight: 640, color: "var(--text-2)", margin: "0 0 7px" }}>
              Kata sandi
            </label>
            <div ref={fieldRef} style={{ position: "relative" }}>
              <input
                id="jkk-password"
                ref={inputRef}
                className="jkk-field"
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="••••••••"
                aria-invalid={!!error}
                style={{ ...inputStyle, borderColor: error ? "#FF3B30" : "var(--sep-2)" }}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                style={revealBtn}
              >
                {reveal ? "Sembunyikan" : "Lihat"}
              </button>
            </div>
            <div style={{ minHeight: 26, paddingTop: 7 }}>
              {error && (
                <div key={error} className="jkk-in" role="alert" style={{ fontSize: 13, color: "#FF3B30", lineHeight: 1.4 }}>
                  {error}
                </div>
              )}
            </div>
            <button type="submit" disabled={busy || done} style={{ ...submitBtn, opacity: busy ? 0.85 : 1 }}>
              {done ? (
                <span className="jkk-in">✓ Berhasil masuk</span>
              ) : busy ? (
                <>
                  <span className="jkk-spinner" style={btnSpinner} />
                  Memeriksa…
                </>
              ) : (
                "Masuk"
              )}
            </button>
          </form>
        </div>

        <div className="jkk-in" style={{ textAlign: "center", maxWidth: 380, animationDelay: "120ms" }}>
          <a href="/demo" style={{ color: "var(--accent)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            Lihat contoh tampilan publik ›
          </a>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.55 }}>
            Laporan yang dibagikan lewat tombol <b>Bagikan</b> tetap bisa dibuka siapa pun yang memegang tautannya, tanpa login — hanya untuk rentang tanggal pada tautan itu.
          </p>
        </div>
      </main>
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
const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 380,
  background: "var(--surface)",
  border: "1px solid var(--sep)",
  borderRadius: 22,
  boxShadow: "var(--shadow-lg)",
  padding: "30px 24px 24px",
  display: "flex",
  flexDirection: "column",
};
const logoBox: CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: 15,
  margin: "0 auto",
  background: "var(--accent)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontWeight: 760,
  fontSize: 26,
  boxShadow: "0 8px 24px rgba(10,132,255,.35)",
};
const noteStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 11,
  fontSize: 13,
  lineHeight: 1.5,
  marginBottom: 16,
};
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px 96px 12px 14px",
  borderRadius: 12,
  border: "1px solid var(--sep-2)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 16,
  outline: "none",
};
const revealBtn: CSSProperties = {
  position: "absolute",
  right: 6,
  top: 6,
  bottom: 6,
  border: "none",
  background: "var(--fill)",
  color: "var(--text-2)",
  borderRadius: 8,
  padding: "0 11px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
const submitBtn: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  borderRadius: 12,
  padding: "13px 20px",
  fontSize: 16,
  fontWeight: 640,
  cursor: "pointer",
  marginTop: 4,
};
const btnSpinner: CSSProperties = {
  width: 15,
  height: 15,
  borderRadius: "50%",
  border: "2px solid rgba(255,255,255,.4)",
  borderTopColor: "#fff",
  animation: "jkk-spin .62s linear infinite",
};
