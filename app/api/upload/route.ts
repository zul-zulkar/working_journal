import { NextRequest, NextResponse } from "next/server";
import { storeImage } from "@/lib/storage";
import { ConfigError } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel serverless caps request bodies at ~4.5 MB; images are compressed
// client-side (max 1280 px JPEG) and uploaded one request per file.
const MAX_BYTES = 4 * 1024 * 1024;

// Accepts multipart/form-data with one or more `file` fields; stores each in
// Vercel Blob (or legacy Drive fallback) and returns [{ url?, fileId?, name }].
// The client keeps url/fileId in the evidence JSON and renders via imageUrl().
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
          { error: `Berkas "${file.name}" melebihi 4 MB.` },
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
      const uploaded = await storeImage(
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
