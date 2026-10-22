import { NextResponse } from "next/server";
import { requireMeetingAccess } from "@/lib/meetings";
import { saveStoredPart } from "@/lib/storage";

// Receives one small recording chunk. The client sends chunks independently so
// large videos never pass through a single Server Action request.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await requireMeetingAccess(id);
  const form = await request.formData();
  const seq = String(form.get("seq") ?? "");
  const ext = String(form.get("ext") ?? "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
  const chunk = form.get("chunk");
  if (!/^\d+$/.test(seq) || !(chunk instanceof File) || chunk.size === 0) {
    return NextResponse.json({ error: "Invalid recording chunk" }, { status: 400 });
  }
  const key = `recordings/${id}/part-${seq.padStart(5, "0")}.${ext}`;
  try {
    await saveStoredPart(key, Buffer.from(await chunk.arrayBuffer()));
  } catch (error) {
    console.error(`[recording upload] failed to store part ${seq} for ${id}:`, error);
    return NextResponse.json(
      { error: "The server could not store this recording part." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, key });
}
