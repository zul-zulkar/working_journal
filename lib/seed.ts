import type { Activity, Category, Group, JournalData } from "./types";

// Sample content ported from the prototype's seed() so a fresh sheet shows the
// same starter data the design was mocked up with. Used only when both tabs are
// empty on first run.

const PAL = [
  "#0A84FF",
  "#FF9F0A",
  "#34C759",
  "#BF5AF2",
  "#FF375F",
  "#30B0C7",
  "#5E5CE6",
  "#FFD60A",
  "#AC8E68",
  "#64D2FF",
];

let counter = 0;
function sid(): string {
  counter += 1;
  return "seed-" + Date.now().toString(36) + "-" + counter.toString(36);
}

export function seedData(): JournalData {
  // One periode covering all sample activities so the seeded data is usable out
  // of the box (Rencana Kinerja are only selectable inside a group's date range).
  // The user can split this into semesters via the management page.
  const group: Group = {
    id: sid(),
    name: "SKP Tahun 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  };
  const groups: Group[] = [group];

  const cat = (name: string, ci: number): Category => ({
    id: sid(),
    name,
    color: PAL[ci],
    groupId: group.id,
  });
  const cats: Category[] = [
    cat("Penyusunan Laporan", 0),
    cat("Pelayanan Administrasi", 2),
    cat("Rapat & Koordinasi", 3),
    cat("Pengembangan Sistem", 5),
    cat("Monitoring & Evaluasi", 1),
  ];
  const cid = (n: number) => cats[n].id;
  const link = (name: string, url: string) => ({
    id: sid(),
    type: "link" as const,
    name,
    url,
  });
  const act = (
    ci: number,
    sd: string,
    ed: string,
    st: string,
    et: string,
    title: string,
    cap: string,
    ev: Activity["evidence"] = [],
  ): Activity => ({
    id: sid(),
    categoryId: cid(ci),
    startDate: sd,
    endDate: ed || sd,
    startTime: st || "",
    endTime: et || "",
    title,
    capaian: cap,
    evidence: ev,
  });

  const activities: Activity[] = [
    act(
      0,
      "2026-06-29",
      "2026-07-01",
      "",
      "",
      "Penyusunan Laporan Kinerja Triwulan II",
      "Menyelesaikan draf Laporan Kinerja Triwulan II meliputi rekap capaian indikator, realisasi anggaran, dan dokumentasi kegiatan. Draf telah dikirim ke koordinator untuk direviu.",
      [
        link("Draf Laporan (Google Docs)", "https://drive.google.com/"),
        link("Lampiran Data Pendukung", "https://drive.google.com/"),
      ],
    ),
    act(
      2,
      "2026-07-01",
      "2026-07-01",
      "09:00",
      "11:30",
      "Rapat Koordinasi Program Kerja Semester",
      "Mengikuti rapat koordinasi pembahasan target program kerja semester berikutnya. Mencatat 6 poin tindak lanjut dan menyusun notula rapat.",
      [link("Notula Rapat", "https://drive.google.com/")],
    ),
    act(
      1,
      "2026-06-30",
      "2026-06-30",
      "",
      "",
      "Verifikasi Berkas Kepegawaian",
      "Memverifikasi 24 berkas usulan kenaikan pangkat pegawai. Seluruh berkas telah dicek kelengkapannya, 21 dinyatakan lengkap dan 3 dikembalikan untuk dilengkapi.",
      [],
    ),
    act(
      3,
      "2026-06-24",
      "2026-06-27",
      "",
      "",
      "Pengembangan Modul Input Jurnal Kegiatan",
      "Mengembangkan modul input data jurnal kegiatan pada aplikasi internal, termasuk fitur unggah bukti dukung dan validasi rentang tanggal.",
      [
        link("Repository", "https://drive.google.com/"),
        link("Dokumentasi Teknis", "https://drive.google.com/"),
      ],
    ),
    act(
      4,
      "2026-07-02",
      "2026-07-03",
      "",
      "",
      "Monitoring Pelaksanaan Kegiatan Lapangan",
      "Melaksanakan monitoring ke 3 lokasi kegiatan lapangan untuk memastikan kesesuaian pelaksanaan dengan rencana kerja. Menyusun catatan temuan dan rekomendasi tindak lanjut.",
      [link("Foto Dokumentasi (Drive)", "https://drive.google.com/")],
    ),
    act(
      1,
      "2026-07-03",
      "2026-07-03",
      "13:00",
      "15:00",
      "Pelayanan Surat Masuk dan Disposisi",
      "Memproses 18 surat masuk, melakukan pencatatan agenda, dan menyiapkan lembar disposisi untuk pimpinan.",
      [],
    ),
    act(
      0,
      "2026-07-06",
      "2026-07-06",
      "",
      "",
      "Rekapitulasi Realisasi Anggaran Bulanan",
      "Menyusun rekapitulasi realisasi anggaran bulan Juni 2026 dan menyiapkan bahan evaluasi serapan anggaran.",
      [link("Spreadsheet Rekap", "https://drive.google.com/")],
    ),
    act(
      2,
      "2026-07-07",
      "2026-07-08",
      "10:00",
      "12:00",
      "Koordinasi Persiapan Bimbingan Teknis",
      "Berkoordinasi dengan narasumber dan panitia terkait persiapan bimbingan teknis: jadwal, materi, dan kebutuhan logistik.",
      [],
    ),
  ];

  return { activities, categories: cats, groups };
}
