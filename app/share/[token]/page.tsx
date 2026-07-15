import type { Metadata } from "next";
import { getDataReadOnly } from "@/lib/sheets";
import { buildReport } from "@/lib/report";
import { decodeShareToken } from "@/lib/shareToken";
import { ConfigError } from "@/lib/google";
import ShareReport from "@/components/ShareReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  try {
    const cfg = decodeShareToken(params.token);
    return { title: cfg ? `${cfg.title} — Laporan` : "Laporan Kegiatan" };
  } catch {
    return { title: "Laporan Kegiatan" };
  }
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div data-theme="light" style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100dvh" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "90px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 44, opacity: 0.5, marginBottom: 8 }}>⚠︎</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>{body}</p>
      </div>
    </div>
  );
}

export default async function SharePage({
  params,
}: {
  params: { token: string };
}) {
  let cfg;
  try {
    cfg = decodeShareToken(params.token);
  } catch (err) {
    if (err instanceof ConfigError) {
      return (
        <Notice
          title="Laporan belum tersedia"
          body="Server belum dikonfigurasi untuk tautan Bagikan (SHARE_TOKEN_SECRET)."
        />
      );
    }
    throw err;
  }
  if (!cfg) {
    return (
      <Notice
        title="Tautan tidak valid"
        body="Tautan laporan ini tidak dapat dibaca. Minta tautan baru dari pemilik jurnal."
      />
    );
  }

  try {
    const data = await getDataReadOnly();
    const report = buildReport(data, cfg);
    return <ShareReport report={report} />;
  } catch (err) {
    if (err instanceof ConfigError) {
      return (
        <Notice
          title="Laporan belum tersedia"
          body="Sumber data Google Sheets belum dikonfigurasi pada server."
        />
      );
    }
    console.error("[/share]", err);
    return (
      <Notice
        title="Gagal memuat laporan"
        body="Terjadi kesalahan saat mengambil data. Coba muat ulang halaman ini."
      />
    );
  }
}
