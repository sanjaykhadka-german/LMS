import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedOrder {
  customer_hint: string | null;
  required_date: string | null;
  notes: string | null;
  lines: {
    item_hint: string;
    qty: number | null;
    uom: string | null;
    unit_price: number | null;
    notes: string | null;
  }[];
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("image") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  const prompt = `You are an order entry assistant for German Butchery, a meat processing company.

Extract order information from this image (which may be a screenshot of an email, text message, WhatsApp, or handwritten note).

Return ONLY valid JSON in this exact shape, with no markdown or explanation:
{
  "customer_hint": "customer name or company if visible, null if not found",
  "required_date": "YYYY-MM-DD if a delivery/required date is visible, null if not found",
  "notes": "any general order notes or special instructions, null if none",
  "lines": [
    {
      "item_hint": "product name as written",
      "qty": 5,
      "uom": "kg or carton or inner or null",
      "unit_price": null,
      "notes": "any line-specific note or null"
    }
  ]
}

Rules:
- Extract every distinct product line as a separate entry in lines[]
- For qty: extract the number only (e.g. "5 kg" → qty: 5, uom: "kg")
- For uom: normalise to one of: "kg", "carton", "inner" — or null if unclear
- If the image contains no order information, return { "customer_hint": null, "required_date": null, "notes": null, "lines": [] }
- Never guess or invent data not visible in the image`;

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const extracted: ExtractedOrder = JSON.parse(cleaned);

    return NextResponse.json({ ok: true, extracted });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Extraction failed: ${msg}` }, { status: 500 });
  }
}
