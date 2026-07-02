"use client";

import { useState } from "react";
import type { ReportModel } from "@/lib/report";
import { parseStyle } from "@/lib/style";
import Lightbox, { LightboxState } from "./Lightbox";

export default function ReportView({
  report,
  onToggleTheme,
  onBack,
  backLabel = "‹ Kembali",
}: {
  report: ReportModel;
  onToggleTheme: () => void;
  onBack: () => void;
  backLabel?: string;
}) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const openLb = (images: string[], index: number, title: string) => {
    if (images.length) setLightbox({ images, index, title });
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", animation: "jkk-fade .3s ease" }}>
      {/* top bar */}
      <div
        className="jkk-noprint"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px clamp(14px,4vw,28px)",
          background: "var(--surface)",
          borderBottom: "1px solid var(--sep)",
          backdropFilter: "saturate(180%) blur(20px)",
        }}
      >
        <button onClick={onBack} style={backBtn}>
          {backLabel}
        </button>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Pratinjau Laporan
        </div>
        <button onClick={onToggleTheme} title="Ganti tema" style={iconBtn}>
          ◐
        </button>
        <button
          onClick={() => window.print()}
          style={{
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            borderRadius: 9,
            padding: "8px 15px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Cetak / PDF
        </button>
      </div>

      <div
        style={{
          maxWidth: 940,
          margin: "0 auto",
          padding: "clamp(22px,4vw,48px) clamp(16px,4vw,40px) 80px",
        }}
      >
        <header style={{ borderBottom: "2px solid var(--text)", paddingBottom: 22, marginBottom: 30 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--accent)",
              marginBottom: 10,
            }}
          >
            Bukti Dukung Laporan Kegiatan
          </div>
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: "clamp(26px,4vw,38px)",
              fontWeight: 760,
              letterSpacing: "-.025em",
              lineHeight: 1.08,
            }}
          >
            {report.title}
          </h1>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 18px",
              color: "var(--text-2)",
              fontSize: 15,
            }}
          >
            <span>
              Periode: <b style={{ color: "var(--text)" }}>{report.rangeLabel}</b>
            </span>
            <span>Dibuat {report.generated}</span>
          </div>
        </header>

        {report.empty && (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--text-3)" }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text-2)" }}>
              Tidak ada kegiatan pada periode ini
            </div>
            <div style={{ fontSize: 14, marginTop: 6 }}>
              Sesuaikan rentang tanggal pada menu Bagikan.
            </div>
          </div>
        )}

        {/* STATISTIK */}
        {report.showStats && !report.empty && (
          <section style={{ marginBottom: 38 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                gap: 14,
                marginBottom: 22,
              }}
            >
              <StatCard value={report.total} label="Total Kegiatan" />
              <StatCard value={report.catCount} label="Rencana Kinerja" />
              <StatCard value={report.rangeDays} label="Hari Periode" />
            </div>
            <div style={cardBox}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 14,
                }}
              >
                Sebaran per Rencana Kinerja
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                {report.catStats.map((s, i) => (
                  <div key={i}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: 3,
                          background: s.color,
                          flex: "none",
                        }}
                      />
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 560 }}>{s.name}</span>
                      <span
                        style={{
                          fontSize: 13,
                          color: "var(--text-2)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {s.count} · {s.pct}%
                      </span>
                    </div>
                    <div
                      style={{ height: 8, background: "var(--fill)", borderRadius: 5, overflow: "hidden" }}
                    >
                      <div style={{ height: "100%", borderRadius: 5, ...parseStyle(s.barStyle) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* TIMELINE */}
        {report.showTimeline && !report.empty && (
          <section style={{ marginBottom: 38 }}>
            <h2 style={sectionH2}>Lini Masa Kegiatan</h2>
            <div style={{ ...cardBox, overflow: "hidden" }}>
              <div style={{ position: "relative", height: 22, marginBottom: 6 }}>
                {report.ticks.map((tk, i) => (
                  <span
                    key={i}
                    style={{
                      position: "absolute",
                      top: 0,
                      transform: "translateX(-50%)",
                      fontSize: 11,
                      color: "var(--text-3)",
                      whiteSpace: "nowrap",
                      left: `${tk.left}%`,
                    }}
                  >
                    {tk.label}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {report.gRows.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(120px,190px) 1fr",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={ellip(13, 600)}>{r.title}</div>
                      <div style={{ ...ellip(11, 400), color: "var(--text-3)" }}>{r.dateLabel}</div>
                    </div>
                    <div
                      style={{ position: "relative", height: 26, background: "var(--fill)", borderRadius: 7 }}
                    >
                      <div
                        onClick={() => openLb(r.images, 0, r.title)}
                        title={r.title}
                        style={{
                          position: "absolute",
                          top: 4,
                          height: 18,
                          borderRadius: 6,
                          cursor: "pointer",
                          boxShadow: "0 1px 2px rgba(0,0,0,.15)",
                          ...parseStyle(r.barStyle),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* GRID */}
        {report.showGrid && !report.empty && (
          <section style={{ marginBottom: 38 }}>
            <h2 style={sectionH2}>Kartu Kegiatan &amp; Bukti Dukung</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                gap: 16,
              }}
            >
              {report.items.map((it) => (
                <article
                  key={it.id}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--sep)",
                    borderRadius: 16,
                    overflow: "hidden",
                    boxShadow: "var(--shadow)",
                    display: "flex",
                    flexDirection: "column",
                    breakInside: "avoid",
                  }}
                >
                  {it.hasCover ? (
                    <button
                      onClick={() => openLb(it.images, 0, it.title)}
                      style={{
                        height: 140,
                        border: "none",
                        backgroundColor: "var(--fill)",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        cursor: "zoom-in",
                        position: "relative",
                        padding: 0,
                        backgroundImage: `url('${it.cover}')`,
                      }}
                    >
                      {it.imgCountMore && <span style={countBadge}>{it.imgCountLabel}</span>}
                    </button>
                  ) : (
                    <div style={hatchBox(80)}>
                      <span style={monoNote}>{it.coverNote}</span>
                    </div>
                  )}
                  <div style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <span style={catChipInline}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: it.catColor }} />
                      {it.catName}
                    </span>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 640, letterSpacing: "-.01em", lineHeight: 1.25 }}>
                      {it.title}
                    </h3>
                    <p style={clamp3}>{it.capaian}</p>
                    <div style={{ marginTop: "auto", paddingTop: 6, fontSize: 12, color: "var(--text-3)" }}>
                      {it.dateLabel}
                    </div>
                    {it.linkCount > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {it.links.map((lk, i) => (
                          <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" style={reportLink}>
                            ↗ {lk.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* PER-DATE */}
        {report.showReport && !report.empty && (
          <section>
            <h2 style={sectionH2}>Rincian per Tanggal</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {report.groups.map((g) => (
                <div key={g.key} style={{ breakInside: "avoid" }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      padding: "7px 0",
                      borderBottom: "1px solid var(--sep-2)",
                      marginBottom: 10,
                      textTransform: "capitalize",
                    }}
                  >
                    {g.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {g.items.map((it) => (
                      <div key={it.id} style={{ display: "flex", gap: 14, padding: "2px 0" }}>
                        <div style={{ width: 4, flex: "none", borderRadius: 3, background: it.catColor }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "baseline", marginBottom: 3 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-2)" }}>{it.catName}</span>
                            {it.rangeBadge && (
                              <span style={{ fontSize: 11.5, color: "var(--accent)", fontWeight: 600 }}>{it.rangeBadge}</span>
                            )}
                            {it.timeLabel && (
                              <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{it.timeLabel}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 640, letterSpacing: "-.01em" }}>{it.title}</div>
                          <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.5, marginTop: 3 }}>{it.capaian}</div>
                          {it.evCount > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 9, alignItems: "center" }}>
                              {it.images.map((url, i) => (
                                <button
                                  key={i}
                                  onClick={() => openLb(it.images, i, it.title)}
                                  style={{
                                    width: 52,
                                    height: 52,
                                    borderRadius: 8,
                                    border: "1px solid var(--sep)",
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                    cursor: "zoom-in",
                                    padding: 0,
                                    backgroundImage: `url('${url}')`,
                                  }}
                                />
                              ))}
                              {it.links.map((lk, i) => (
                                <a
                                  key={i}
                                  href={lk.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    fontSize: 12.5,
                                    color: "var(--accent)",
                                    textDecoration: "none",
                                    background: "var(--fill)",
                                    padding: "5px 11px",
                                    borderRadius: 8,
                                  }}
                                >
                                  ↗ {lk.name}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer
          style={{
            marginTop: 44,
            paddingTop: 18,
            borderTop: "1px solid var(--sep)",
            fontSize: 12,
            color: "var(--text-3)",
            textAlign: "center",
          }}
        >
          Dihasilkan oleh Jurnal Kegiatan — {report.generated}
        </footer>
      </div>

      {lightbox && <Lightbox state={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div style={cardBox}>
      <div style={{ fontSize: 38, fontWeight: 740, letterSpacing: "-.03em", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

const backBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "none",
  background: "var(--fill)",
  color: "var(--text)",
  borderRadius: 9,
  padding: "8px 13px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const iconBtn: React.CSSProperties = {
  border: "none",
  background: "var(--fill)",
  color: "var(--text)",
  borderRadius: 9,
  width: 38,
  height: 38,
  fontSize: 15,
  cursor: "pointer",
};
const cardBox: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--sep)",
  borderRadius: 16,
  padding: "18px 20px",
  boxShadow: "var(--shadow)",
};
const sectionH2: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 700,
  letterSpacing: "-.02em",
  margin: "0 0 14px",
};
const countBadge: React.CSSProperties = {
  position: "absolute",
  right: 8,
  bottom: 8,
  background: "rgba(0,0,0,.62)",
  color: "#fff",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 9px",
  borderRadius: 20,
};
const catChipInline: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--text-2)",
  width: "fit-content",
};
const clamp3: React.CSSProperties = {
  margin: 0,
  color: "var(--text-2)",
  fontSize: 13,
  lineHeight: 1.45,
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
const reportLink: React.CSSProperties = {
  fontSize: 12,
  color: "var(--accent)",
  textDecoration: "none",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const monoNote: React.CSSProperties = {
  fontFamily: "ui-monospace,SFMono-Regular,monospace",
  fontSize: 11,
  color: "var(--text-3)",
};
function hatchBox(height: number): React.CSSProperties {
  return {
    height,
    background:
      "repeating-linear-gradient(135deg,var(--fill),var(--fill) 9px,transparent 9px,transparent 18px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderBottom: "1px solid var(--sep)",
  };
}
function ellip(fontSize: number, fontWeight: number): React.CSSProperties {
  return {
    fontSize,
    fontWeight,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}
