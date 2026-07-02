import { NextRequest, NextResponse } from "next/server";
import { getImage } from "@/lib/drive";
import { ConfigError } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public read-only proxy for evidence images so they render in both the app and
// the public /share report without exposing the service-account credential.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const fileId = params.id;
  if (!fileId) {
    return NextResponse.json({ error: "File id kosong." }, { status: 400 });
  }
  try {
    const { data, mimeType } = await getImage(fileId);
    return new NextResponse(data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[/api/image]", err);
    return NextResponse.json({ error: "Gambar tidak ditemukan." }, { status: 404 });
  }
}
