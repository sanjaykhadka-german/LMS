import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  try {
    const { docId, storagePath, itemId } = await req.json();
    if (!docId || !storagePath) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    const supabase = await createClient();

    // Mark as processing
    await supabase.from("item_spec_documents")
      .update({ extraction_status: "processing" })
      .eq("id", docId);

    // Download PDF from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("item-specs")
      .download(storagePath);

    if (dlErr || !fileData) {
      await supabase.from("item_spec_documents").update({ extraction_status: "failed" }).eq("id", docId);
      return NextResponse.json({ error: "Download failed" }, { status: 500 });
    }

    // Get item context
    const { data: item } = await supabase.from("items").select("name, code, item_type").eq("id", itemId).single();

    // Convert to base64 for Claude
    const buffer = await fileData.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          } as { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } },
          {
            type: "text",
            text: `This is a specification document for food ingredient/product: ${item?.name ?? "unknown"} (${item?.code ?? ""}).

Extract the following values if present. Return ONLY a JSON object with these exact keys, using null for anything not found:

{
  "storage_temp": "e.g. 0-4°C or Frozen -18°C",
  "shelf_life": "e.g. 90 days from production",
  "origin": "country or region of origin",
  "fat_content": "e.g. 18% max",
  "protein": "e.g. 22% min",
  "moisture": "e.g. 65% max",
  "ph": "e.g. 5.8-6.2",
  "water_activity": "e.g. 0.97 max",
  "microbiological": "summary of micro spec e.g. TPC <100,000 cfu/g",
  "allergens": "comma-separated list of allergens declared",
  "packaging": "e.g. Vacuum packed in 10kg cartons",
  "net_weight": "e.g. 10kg per carton",
  "supplier_code": "supplier product code if shown",
  "energy_kj": "per 100g if shown",
  "protein_g": "per 100g if shown",
  "fat_total_g": "per 100g if shown",
  "carbs_g": "per 100g if shown",
  "sodium_mg": "per 100g if shown"
}

Return only the JSON object, no explanation.`,
          },
        ],
      }],
    });

    // Parse Claude's response
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    let extracted: Record<string, unknown> = {};
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
    } catch {
      extracted = { raw: text };
    }

    // Remove nulls
    Object.keys(extracted).forEach(k => { if (extracted[k] === null) delete extracted[k]; });

    // Save extracted data
    await supabase.from("item_spec_documents").update({
      extraction_status: "done",
      extracted_data: extracted,
    }).eq("id", docId);

    // Auto-populate item spec fields if they are currently empty
    const updates: Record<string, string> = {};
    if (extracted.storage_temp && !item?.item_type) updates.spec_storage_temp = String(extracted.storage_temp);

    const { data: currentItem } = await supabase.from("items")
      .select("spec_storage_temp, spec_shelf_life, spec_origin, spec_fat_content, spec_protein, spec_moisture, spec_ph, spec_water_activity, spec_micro")
      .eq("id", itemId).single();

    if (currentItem) {
      if (!currentItem.spec_storage_temp && extracted.storage_temp)  updates.spec_storage_temp  = String(extracted.storage_temp);
      if (!currentItem.spec_shelf_life   && extracted.shelf_life)    updates.spec_shelf_life    = String(extracted.shelf_life);
      if (!currentItem.spec_origin       && extracted.origin)        updates.spec_origin        = String(extracted.origin);
      if (!currentItem.spec_fat_content  && extracted.fat_content)   updates.spec_fat_content   = String(extracted.fat_content);
      if (!currentItem.spec_protein      && extracted.protein)       updates.spec_protein       = String(extracted.protein);
      if (!currentItem.spec_moisture     && extracted.moisture)      updates.spec_moisture      = String(extracted.moisture);
      if (!currentItem.spec_ph           && extracted.ph)            updates.spec_ph            = String(extracted.ph);
      if (!currentItem.spec_water_activity && extracted.water_activity) updates.spec_water_activity = String(extracted.water_activity);
      if (!currentItem.spec_micro        && extracted.microbiological) updates.spec_micro       = String(extracted.microbiological);

      if (Object.keys(updates).length > 0) {
        await supabase.from("items").update(updates).eq("id", itemId);
      }
    }

    return NextResponse.json({ ok: true, extracted, fieldsUpdated: Object.keys(updates) });
  } catch (err) {
    console.error("extract-spec error", err);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}
