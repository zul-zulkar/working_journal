import type { Metadata } from "next";
import { seedData } from "@/lib/seed";
import { journalInRange } from "@/lib/report";
import JurnalApp from "@/components/JurnalApp";

// Public example of what a shared report looks like — built from the bundled
// sample data (lib/seed.ts), never from the owner's spreadsheet, so it is safe
// to show to anyone. Real reports live at /share/[token].
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Contoh Laporan — Jurnal Kegiatan",
  description: "Contoh tampilan publik laporan kegiatan kerja (data fiktif).",
};

const FROM = "2026-06-24";
const TO = "2026-07-08";

export default function DemoPage() {
  return (
    <JurnalApp
      shared={{
        title: "Contoh Laporan Kegiatan Kerja",
        from: FROM,
        to: TO,
        data: journalInRange(seedData(), FROM, TO),
        demo: true,
      }}
    />
  );
}
