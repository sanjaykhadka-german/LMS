import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  try {
    const { storagePath, supplierName } = await req.json();
    if (!storagePath) return NextResponse.json({ error: "Missing storagePath" }, { status: 400 });

    const supabase = await createClient();

    // Download PDF from supplier-certs bucket
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("supplier-certs")
      .download(storagePath);

    if (dlErr || !fileData) {
      return NextResponse.json({ error: "Could not download file" }, { status: 500 });
    }

    const buffer = await fileData.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          } as { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } },
          {
            type: "text",
            text: `This is a supplier certification document${supplierName ? ` for supplier: ${supplierName}` : ""}.

Extract the following values. Return ONLY a valid JSON object with these exact keys, using null for anything not found:

{
  "certification_type": "one of: HACCP, SQF, BRC / BRCGS, ISO 22000, FSSC 22000, Halal, Kosher, Organic, WQA, AQIS / DAFF, Safe Food Queensland, Freshcare — or the exact certification name as written on the document",
  "certificate_number": "the certificate, licence or registration number",
  "issued_by": "the name of the certifying or issuing body",
  "issued_date": "ISO format YYYY-MM-DD, or null if not found",
  "expiry_date": "ISO format YYYY-MM-DD, or null if not found",
  "notes": "any relevant scope, conditions, or site details — keep to one sentence"
}

Return only the JSON object, no explanation.`,
          },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    let extracted: Record<string, string | null> = {};
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "Could not parse extraction" }, { status: 500 });
    }

    // Remove nulls so client knows what was actually found
    Object.keys(extracted).forEach(k => { if (extracted[k] === null) delete extracted[k]; });

    return NextResponse.json({ ok: true, extracted });
  } catch (err) {
    console.error("extract-cert error", err);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}
