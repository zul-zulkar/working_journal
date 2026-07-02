import { NextRequest, NextResponse } from "next/server";
import { uploadImage } from "@/lib/drive";
import { ConfigError } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file (images are compressed client-side)

// Accepts multipart/form-data with one or more `file` fields; uploads each to
// Drive and returns [{ fileId, name }]. The client stores fileId as evidence and
// renders it via /api/image/[fileId].
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "Tidak ada berkas." }, { status: 400 });
    }

    const results = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `Berkas "${file.name}" melebihi 8 MB.` },
          { status: 413 },
        );
      }
      if (!/^image\//.test(file.type)) {
        return NextResponse.json(
          { error: `Berkas "${file.name}" bukan gambar.` },
          { status: 415 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const uploaded = await uploadImage(
        buffer,
        file.type,
        file.name || "evidence.jpg",
      );
      results.push(uploaded);
    }

    return NextResponse.json({ files: results });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message, code: "config" }, { status: 503 });
    }
    console.error("[/api/upload]", err);
    return NextResponse.json({ error: "Gagal mengunggah gambar." }, { status: 500 });
  }
}
