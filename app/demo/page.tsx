import type { Metadata } from "next";
import { seedData } from "@/lib/seed";
import { buildReport } from "@/lib/report";
import ShareReport from "@/components/ShareReport";

// Public example of what a shared report looks like — built from the bundled
// sample data (lib/seed.ts), never from the owner's spreadsheet, so it is safe
// to show to anyone. Real reports live at /share/[token].
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Contoh Laporan — Jurnal Kegiatan",
  description: "Contoh tampilan publik laporan kegiatan kerja (data fiktif).",
};

export default function DemoPage() {
  const report = buildReport(seedData(), {
    title: "Contoh Laporan Kegiatan Kerja",
    from: "2026-06-24",
    to: "2026-07-08",
    stats: true,
    timeline: true,
    hourly: true,
    grid: true,
    table: true,
    report: true,
  });
  return <ShareReport report={report} demo />;
}
