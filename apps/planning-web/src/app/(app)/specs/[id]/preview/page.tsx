import { createClient } from "@/lib/supabase/server";
import { storage } from "@/lib/storage";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import PrintTrigger from "./_print-trigger";
import SendSpecButton from "./_send-spec-button";
import { draftProductSpec } from "../../actions";
import { CountryMark } from "@/components/coo-country-mark";

/**
 * Spec sheet preview / print page.
 *
 * Tino May 2026 rebuild — render the regulatory + commercial sections an
 * Australian retailer / customer-facing product spec actually needs:
 *   - Tenant logo + company contact details (from tenants table)
 *   - Ingredients statement (migration 091 — auto-populated by BOM walk)
 *   - Allergens (existing)
 *   - Storage & use: storage temp, shelf life from manufacture, MLOR, RTE
 *     vs cook-required label, heating instructions
 *   - Country of Origin statement (migration 091)
 *   - Pack hierarchy summary: per piece / per inner / per outer / per pallet
 *     (with random-weight disclaimer when item.weight_mode = 'random')
 *   - NIP table with conditional Per-Serving column (hidden when the item is
 *     flagged nip_large_item — hams, logs etc. — or weight_mode is random
 *     without a meaningful per-piece target weight)
 *   - Company contact footer
 *
 * Skipped per Tino's instruction (May 2026):
 *   - Tare weight per inner pack
 *   - Packaging & Labelling sections
 */

export default async function SpecPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { id } = await params;

  // Spec + item — pulls migration-091 fields (ingredients_statement,
  // country_of_origin, heating_instructions, min_life_on_receival_days),
  // weight_mode / is_rte / nip_large_item / fill_weight_g / pack hierarchy
  // off the joined item, and the regular fallback fields (storage, shelf
  // life, micro etc.) on both spec and item so spec overrides win.
  const { data: spec } = await supabase
    .from("product_specs")
    .select(`
      id, version, version_label, status, approved_at, internal_notes,
      spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
      spec_fat_content, spec_protein, spec_moisture, spec_ph,
      spec_water_activity, spec_micro,
      storage_class, nutrition_lab_tested,
      ingredients_statement, country_of_origin, coo_show_breakdown, heating_instructions,
      min_life_on_receival_days, pack_tare_weight_inner_g, barcode_override,
      nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
      nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
      nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
      allergens, created_at, updated_at,
      item:item_id(
        id, code, name, item_type, department, unit, description,
        weight_mode, is_rte, nip_large_item,
        target_weight_g, fill_weight_g, units_per_inner, units_per_outer, units_per_pallet,
        spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
        spec_fat_content, spec_protein, spec_moisture, spec_ph,
        spec_water_activity, spec_micro,
        nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
        nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
        nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
        allergens
      ),
      approver:approved_by(id, full_name)
    `)
    .eq("id", id)
    .single();

  if (!spec) notFound();

  const item = spec.item as any;

  // Pull tenant + pallet config + spec images + barcode in one Promise.all so
  // the page paints in a single round-trip rather than four serial ones.
  const [
    { data: tenant },
    { data: palletConfig },
    { data: images },
    { data: barcodeRow },
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, abn, company_phone, company_email, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_postcode, billing_country, logo_url")
      .eq("id", (await supabase.from("profiles").select("tenant_id").eq("id", user.id).single()).data?.tenant_id ?? "")
      .single(),
    supabase
      .from("item_pallet_config")
      .select("*")
      .eq("item_id", item?.id)
      .maybeSingle(),
    supabase
      .from("spec_images")
      .select("id, image_type, public_url, caption, display_order")
      .eq("item_id", item?.id)
      .order("display_order"),
    supabase
      .from("item_barcodes")
      .select("barcode_value")
      .eq("item_id", item?.id)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // ── Resolved fields: spec override, then item master fallback. ───────────
  function f(specVal: any, itemVal: any) { return specVal ?? itemVal ?? null; }
  function n(v: number | null) { return v != null ? Number(v).toFixed(1) : null; }

  // Storage class drives canonical wording (Tino May 2026). When the spec
  // has a class set, use the canonical text; otherwise fall back to the
  // free-text storage_temp field on the spec / item.
  const storageClass: string | null = (spec as { storage_class?: string | null }).storage_class ?? null;
  const STORAGE_TEXT: Record<string, string> = {
    chilled: "<5°C (chilled)",
    frozen:  "-18°C (frozen)",
    ambient: "Ambient",
  };
  const storageTemp        = storageClass && STORAGE_TEXT[storageClass]
    ? STORAGE_TEXT[storageClass]
    : f(spec.spec_storage_temp, item?.spec_storage_temp);
  const shelfLife          = f(spec.spec_shelf_life,   item?.spec_shelf_life);
  const origin             = f(spec.country_of_origin, spec.spec_origin) ?? item?.spec_origin ?? null;
  const showCooBreakdown   = !!(spec as { coo_show_breakdown?: boolean }).coo_show_breakdown;
  // Phase 3H.5 v2: when the spec opts in to the on-PDF breakdown, recompute
  // the live origin shares from the BOM walk so the printed page reflects
  // the latest ingredient component countries (cheaper to recompute than to
  // mirror the JSON to a column and worry about staleness).
  let cooBreakdownLive: {
    localCountry: string | null;
    localAdjective: string | null;
    localPct: number;
    knownCoverage: number;
    byCountry: { country: string; pct: number }[];
    byIngredient: { name: string; country: string; pct: number; class: string | null }[];
  } | null = null;
  // v3 (Tino May 8 2026): the CoO country mark is now ALWAYS rendered (it's
  // an Australian consumer-law requirement). The toggle only controls whether
  // the per-country breakdown list prints alongside it. So we recompute the
  // breakdown unconditionally when the item exists.
  if (item?.id) {
    const draft = await draftProductSpec(item.id);
    if (draft.data?.cooBreakdown) {
      const cb = draft.data.cooBreakdown;
      cooBreakdownLive = {
        localCountry: cb.localCountry,
        localAdjective: cb.localAdjective,
        localPct: cb.localPct,
        knownCoverage: cb.knownCoverage,
        byCountry: cb.byCountry,
        byIngredient: cb.byIngredient,
      };
    }
  }
  const ingredientsLine    = (spec.ingredients_statement ?? "").trim() || null;
  const heating            = (spec.heating_instructions ?? "").trim() || null;
  const minLifeReceival    = spec.min_life_on_receival_days ?? null;
  const specNotes          = f(spec.spec_notes, item?.spec_notes);
  // Allergens — filter against the FSANZ Std 1.2.3 / PEAL list. Defense
  // against legacy items.allergens entries like "Nitrite" (a preservative,
  // not a regulated allergen). Tino May 2026.
  const FSANZ_ALLERGENS = new Set<string>([
    "milk", "dairy",
    "egg", "eggs",
    "fish",
    "crustacea", "crustaceans",
    "mollusc", "molluscs",
    "wheat", "gluten", "cereals containing gluten",
    "soy", "soya", "soybean", "soybeans",
    "peanut", "peanuts",
    "tree nuts", "tree nut",
    "sesame", "sesame seeds",
    "lupin",
    "sulphites", "sulphite", "sulphur dioxide", "sulphites / sulphur dioxide",
    "fsanz_milk", "fsanz_egg", "fsanz_fish", "fsanz_crustacea",
    "fsanz_mollusc", "fsanz_wheat", "fsanz_gluten", "fsanz_soy",
    "fsanz_peanut", "fsanz_tree_nuts", "fsanz_sesame", "fsanz_lupin",
    "fsanz_sulphites",
  ]);
  const rawAllergens = (spec.allergens ?? item?.allergens ?? []) as string[];
  const allergens = rawAllergens.filter(a =>
    FSANZ_ALLERGENS.has(String(a).toLowerCase().trim())
  );
  const barcode            = (spec.barcode_override ?? "").trim() || (barcodeRow as any)?.barcode_value || null;

  // Weight mode + RTE — drive labels / disclaimers / NIP servings logic.
  const weightMode: string | null = (item?.weight_mode ?? "").toString().toLowerCase() || null;
  const isRandom: boolean = weightMode === "random" || weightMode === "catch";
  const isFixed: boolean  = weightMode === "fixed";
  const isRTE: boolean | null = item?.is_rte ?? null;
  const isLargeItem: boolean = !!item?.nip_large_item;
  const labTested: boolean = !!(spec as { nutrition_lab_tested?: boolean }).nutrition_lab_tested;

  // Micro section content. Tino May 2026:
  //   - If operator entered something in spec.spec_micro, render that.
  //   - Else if RTE: bake in FSANZ Schedule 27 defaults for cooked
  //     ready-to-eat smallgoods so the spec carries a compliant baseline.
  //   - Else: render nothing (section omitted entirely).
  const micro: string | null = (spec.spec_micro ?? "").toString().trim() || null;
  const FSANZ_RTE_MICRO_DEFAULT =
    "Listeria monocytogenes — not detected in 25 g\n" +
    "Salmonella spp. — not detected in 25 g\n" +
    "Coagulase-positive Staphylococci — < 100 cfu/g\n" +
    "Standard plate count (TPC) — < 1,000,000 cfu/g\n" +
    "(Reference: FSANZ Standard 1.6.1 / Schedule 27 — limits for ready-to-eat foods.)";
  const microDisplay: string | null = micro
    ? micro
    : (isRTE === true ? FSANZ_RTE_MICRO_DEFAULT : null);

  // Pack hierarchy maths — feed the pack summary block. Per-piece target
  // weight on the FG is the basis for everything; if the FG didn't set its
  // own (rare, since the inherited-attrs view already coalesces from the
  // parent chain), fall back to fill_weight_g.
  const perPieceG: number | null = item?.target_weight_g ?? item?.fill_weight_g ?? null;
  const piecesInner = item?.units_per_inner as number | null;
  const piecesOuter = item?.units_per_outer as number | null;
  const piecesPallet = item?.units_per_pallet as number | null;
  const innerWeightG  = perPieceG && piecesInner  ? perPieceG * piecesInner  : null;
  const outerWeightG  = perPieceG && piecesOuter  ? perPieceG * piecesOuter  : null;
  const palletWeightG = perPieceG && piecesPallet ? perPieceG * piecesPallet : null;
  // Outers per pallet — pallet config gets first crack (operator may have
  // entered it manually); otherwise derive from pieces hierarchy.
  const outersPerPallet = (palletConfig as any)?.units_per_pallet
    && (palletConfig as any)?.ti && (palletConfig as any)?.hi
    ? (palletConfig as any).ti * (palletConfig as any).hi
    : (piecesPallet && piecesOuter ? Math.floor(piecesPallet / piecesOuter) : null);

  /** Format grams as "Xg" or "X.XX kg" depending on size. */
  function fmtWeight(g: number | null): string | null {
    if (g == null) return null;
    if (g >= 1000) return `${(g / 1000).toFixed(g >= 10000 ? 0 : 2)} kg`;
    return `${Math.round(g)} g`;
  }

  // NIP per-serving logic (Tino May 2026):
  //   - The OPERATOR-ENTERED serving size (spec.nut_per_serving_g) is the
  //     trigger. If they leave it blank, the NIP renders Per-100g only and
  //     the Per Serving column is hidden entirely.
  //   - When set: serves per pack = floor(pack weight / serving size) when
  //     we know a pack weight; otherwise just show "Serving size: Xg".
  //   - Large items (hams, logs flagged via nip_large_item) always hide
  //     the per-serving column regardless.
  const enteredServingG: number | null = spec.nut_per_serving_g != null
    ? Number(spec.nut_per_serving_g)
    : null;
  const showServings = !isLargeItem
    && enteredServingG != null && enteredServingG > 0;
  const servingSizeG = showServings ? enteredServingG! : null;
  const servesPerPack = showServings && innerWeightG != null && servingSizeG! > 0
    ? Math.floor(innerWeightG / servingSizeG!)
    : null;

  const nutEnergyKj    = n(f(spec.nut_energy_kj,       item?.nut_energy_kj));
  const nutEnergyKcal  = n(f(spec.nut_energy_kcal,     item?.nut_energy_kcal));
  const nutProtein     = n(f(spec.nut_protein_g,       item?.nut_protein_g));
  const nutFatTotal    = n(f(spec.nut_fat_total_g,     item?.nut_fat_total_g));
  const nutFatSat      = n(f(spec.nut_fat_saturated_g, item?.nut_fat_saturated_g));
  const nutFatTrans    = n(f(spec.nut_fat_trans_g,     item?.nut_fat_trans_g));
  const nutCarbsTotal  = n(f(spec.nut_carbs_total_g,   item?.nut_carbs_total_g));
  const nutCarbsSugars = n(f(spec.nut_carbs_sugars_g,  item?.nut_carbs_sugars_g));
  const nutFibre       = n(f(spec.nut_fibre_g,         item?.nut_fibre_g));
  const nutSodium      = n(f(spec.nut_sodium_mg,       item?.nut_sodium_mg));

  /** Multiply a per-100g value by serving fraction. v is string ("12.3"), result string. */
  function perServing(v: string | null): string | null {
    if (!v || servingSizeG == null) return null;
    const num = Number(v);
    if (!isFinite(num)) return null;
    return (num * servingSizeG / 100).toFixed(1);
  }

  const heroImage   = (images ?? []).find((i: any) => i.image_type === "hero");
  const packedImage = (images ?? []).find((i: any) => i.image_type === "packed");
  // Logo is stored as a Supabase storage path on tenants.logo_url
  // (e.g. "<tenant_id>/logo-<timestamp>.png" in the tenant-branding
  // bucket). The bucket is PRIVATE so getPublicUrl returns a URL that
  // 401s in <img>. Generate a 1-hour signed URL instead — same approach
  // the invoice PDF route uses internally. Tino May 2026.
  const logoPath: string | null = (tenant as any)?.logo_url ?? null;
  let tenantLogo: string | null = null;
  if (logoPath && logoPath.trim() !== "") {
    try {
      tenantLogo = await storage().signedUrl("tenant-branding", logoPath, 3600);
    } catch { tenantLogo = null; }
  }
  const tenantName  = (tenant as any)?.name ?? "—";

  const hasNutrition = !!(nutEnergyKj || nutProtein || nutFatTotal || nutCarbsTotal || nutSodium);

  const approvedDate = spec.approved_at
    ? new Date(spec.approved_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const issueDate = new Date(spec.updated_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  // RTE label: ✓ Ready to Eat (operator can serve as-is) vs ⚠ Cooking
  // required (raw / under-cooked product). is_rte = null means the operator
  // hasn't set it yet — render an explicit "to be confirmed" rather than
  // assuming a default that might mislead the customer.
  const rteLabel = isRTE === true
    ? "READY TO EAT"
    : isRTE === false
      ? "MUST BE FULLY COOKED PRIOR TO CONSUMPTION"
      : null;

  // Address one-liner — drop empty parts so we don't render dangling commas.
  const addressParts = [
    (tenant as any)?.billing_address_line1,
    (tenant as any)?.billing_address_line2,
    [(tenant as any)?.billing_city, (tenant as any)?.billing_state, (tenant as any)?.billing_postcode].filter(Boolean).join(" "),
    (tenant as any)?.billing_country,
  ].filter((s: string | null) => s && s.trim().length > 0);
  const addressLine = addressParts.join(", ");

  return (
    <>
      {/* Toolbar (screen only) - Back + Edit + Print
          Tino May 2026: row click on /specs lands the operator here.
          Edit button is the primary path back into the editor. */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: "#fff", borderBottom: "1px solid #e7e5e4", padding: "0.625rem 1.5rem", display: "flex", alignItems: "center", gap: "1rem", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }} className="no-print">
        <Link href={`/specs`} style={{ color: "#57534e", fontSize: "0.8125rem", textDecoration: "none", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Specs
        </Link>
        <span style={{ color: "#d6d3d1" }}>|</span>
        <span style={{ color: "#1c1917", fontWeight: 600, fontSize: "0.875rem" }}>{item?.name} — Spec Sheet v{spec.version_label}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.625rem" }}>
          <Link
            href={`/specs/${spec.id}`}
            style={{ padding: "0.375rem 1rem", background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.375rem", color: "#1c1917", fontWeight: 600, cursor: "pointer", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}
            title="Open the spec editor to make changes"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </Link>
          <SendSpecButton specId={spec.id} />
          <button
            data-spec-print-trigger="true"
            type="button"
            style={{ padding: "0.375rem 1rem", background: "#b91c1c", border: "none", borderRadius: "0.375rem", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print / Save PDF
          </button>
        </div>
      </div>
      <PrintTrigger />

      {/* Print styles — Tino May 7 v4:
          - Hide every framework chrome class (sidebar, mobile menu button,
            toolbars) so the printed PDF only contains the spec sheet.
          - Strip the spec-page's 72 px top margin so the sheet sits flush
            with the page top.
          - Pin the company footer to the bottom of every page using
            position: fixed inside @media print. Chrome's print engine
            renders fixed elements once at the bottom of EACH page, which
            is the closest browser-printable approximation of a true
            paged-media footer. The @page margin-bottom reserves room
            so spec content above never overlaps the footer band. */}
      <style>{`
        @media print {
          .no-print,
          .sidebar,
          .mobile-menu-btn,
          .sidebar-overlay { display: none !important; }
          body { margin: 0; padding: 0; }
          html, body, main, [class^="layout-"] { padding: 0 !important; margin: 0 !important; }
          .spec-page { margin: 0 !important; padding: 0 !important; max-width: none !important; box-shadow: none !important; }
          .spec-print-footer {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            margin: 0 !important;
            border-top: 2px solid #e5e7eb !important;
            background: #fafafa !important;
          }
        }
        /* Page margin-bottom reserves ~30 mm under spec content for the
           pinned footer. Top is tight so the brand strip lands at the top. */
        @page { margin: 12mm 10mm 30mm 10mm; size: A4; }
      `}</style>

      {/* Spec sheet */}
      <div className="spec-page" style={{ maxWidth: "794px", margin: "72px auto 3rem", background: "#fff", boxShadow: "0 0 40px rgba(0,0,0,0.3)", fontFamily: "system-ui, -apple-system, sans-serif", color: "#1a1a1a" }}>

        {/* Header band — Tino May 2026: toned down. White ground with a
            thin red accent stripe along the top, red title text, item
            name in dark. Logo only renders when we actually have a URL
            (no broken-image alt hanging around). */}
        <div style={{ borderTop: "4px solid #b91c1c", background: "#fff", display: "flex", alignItems: "stretch", borderBottom: "1px solid #e7e5e4" }}>
          {tenantLogo && tenantLogo.trim() !== "" && (
            <div style={{ flexShrink: 0, padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #f3f4f6" }}>
              <img src={tenantLogo} alt={tenantName} style={{ maxHeight: "64px", maxWidth: "120px", objectFit: "contain", display: "block" }} />
            </div>
          )}
          <div style={{ flex: 1, padding: "1.25rem 2rem" }}>
            <div style={{ color: "#b91c1c", fontSize: "0.6875rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "0.375rem" }}>
              Product Specification Sheet
            </div>
            <div style={{ color: "#1c1917", fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.15, marginBottom: "0.25rem" }}>
              {item?.name}
            </div>
            <div style={{ color: "#57534e", fontSize: "0.875rem", display: "flex", gap: "0.625rem", flexWrap: "wrap", alignItems: "center" }}>
              <span>{item?.code}</span>
              <span style={{ color: "#d6d3d1" }}>·</span>
              <span>{item?.department ?? item?.item_type?.replace(/_/g, " ")}</span>
              {weightMode && (
                <>
                  <span style={{ color: "#d6d3d1" }}>·</span>
                  <span style={{ background: "#f5f5f4", padding: "0.1rem 0.5rem", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#44403c" }}>
                    {isFixed ? "Fixed weight" : isRandom ? "Random weight" : weightMode}
                  </span>
                </>
              )}
            </div>
          </div>
          {heroImage?.public_url && (
            <div style={{ width: "140px", flexShrink: 0, overflow: "hidden", borderLeft: "1px solid #f3f4f6" }}>
              <img src={heroImage.public_url} alt="Hero" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
          )}
        </div>

        {/* Meta bar — version, approval, issue date, tenant name */}
        <div style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb", padding: "0.625rem 2rem", display: "flex", gap: "2rem", flexWrap: "wrap", fontSize: "0.75rem" }}>
          <div><span style={{ color: "#6b7280", fontWeight: 600 }}>Version: </span><span style={{ fontWeight: 700 }}>v{spec.version_label}</span></div>
          <div>
            <span style={{ color: "#6b7280", fontWeight: 600 }}>Status: </span>
            <span style={{ fontWeight: 700, color: spec.status === "approved" ? "#16a34a" : "#d97706" }}>
              {spec.status === "approved" ? "✓ Approved" : "Draft"}
            </span>
          </div>
          {approvedDate && (
            <div>
              <span style={{ color: "#6b7280", fontWeight: 600 }}>Approved: </span>
              <span>{approvedDate}</span>
              {(spec.approver as any)?.full_name && <span style={{ color: "#6b7280" }}> by {(spec.approver as any).full_name}</span>}
            </div>
          )}
          <div><span style={{ color: "#6b7280", fontWeight: 600 }}>Issue Date: </span><span>{issueDate}</span></div>
          <div style={{ marginLeft: "auto", color: "#6b7280", fontWeight: 700 }}>{tenantName}</div>
        </div>

        {/* Body */}
        <div style={{ padding: "1.5rem 2rem" }}>

          {/* ── Pack hierarchy summary + packed image ─────────────────────── */}
          <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem" }}>
            {packedImage?.public_url && (
              <div style={{ flexShrink: 0 }}>
                <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.375rem" }}>Packed Product</div>
                <img src={packedImage.public_url} alt="Packed" style={{ width: "180px", height: "140px", objectFit: "cover", borderRadius: "0.375rem", border: "1px solid #e5e7eb", display: "block" }} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <SectionTitle>Product Identification</SectionTitle>
              <SpecGrid>
                {item?.code && <SpecRow label="Product Code" value={item.code} />}
                {/* Unit of Measure (item.unit) intentionally hidden on the
                    spec — it's the internal stock UoM (kg / piece) not a
                    consumer-facing label. The pack hierarchy rows below
                    convey the relevant weight/pieces info. Tino May 2026. */}
                {barcode && <SpecRow label="Barcode" value={barcode} />}
                {perPieceG != null && (
                  <SpecRow
                    label="Per Piece"
                    value={
                      isRandom
                        ? `~${fmtWeight(perPieceG)} (indicative — actual weight printed on each label)`
                        : (fmtWeight(perPieceG) ?? "—")
                    }
                  />
                )}
                {innerWeightG != null && piecesInner != null && (
                  <SpecRow
                    label="Per Inner Pack"
                    value={`${fmtWeight(innerWeightG)} (${piecesInner} ${piecesInner === 1 ? "piece" : "pieces"})`}
                  />
                )}
                {outerWeightG != null && piecesOuter != null && (
                  <SpecRow
                    label="Per Outer / Carton"
                    value={`${fmtWeight(outerWeightG)} (${piecesOuter} pieces)`}
                  />
                )}
                {outersPerPallet != null && (
                  <SpecRow
                    label="Outers per Pallet"
                    value={String(outersPerPallet)}
                  />
                )}
                {palletWeightG != null && (
                  <SpecRow
                    label="Per Pallet"
                    value={fmtWeight(palletWeightG) ?? "—"}
                  />
                )}
              </SpecGrid>
            </div>
          </div>

          {/* Ingredients section moved into the bottom 2-col layout below
              (next to the Nutrition table) per Tino May 7 v4 — keeps the
              NIP compact and avoids the awkward mid-table page break. */}

          {/* ── Allergens ──────────────────────────────────────────────── */}
          {allergens.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <SectionTitle>Allergen Declaration</SectionTitle>
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.375rem", padding: "0.875rem 1rem" }}>
                <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
                  ⚠ Contains Allergens
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                  {allergens.map(a => (
                    <span key={a} style={{ padding: "0.2rem 0.625rem", background: "#fee2e2", border: "1px solid #fecaca", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 700, color: "#991b1b" }}>{a}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Storage and use */}
          {(storageTemp || shelfLife || minLifeReceival != null || rteLabel || heating) && (
            <div style={{ marginBottom: "1.25rem" }}>
              <SectionTitle>Storage &amp; Use</SectionTitle>
              <SpecGrid cols={2}>
                {storageTemp && <SpecRow label="Storage Temperature" value={storageTemp} />}
                {shelfLife && <SpecRow label="Shelf Life from Manufacture" value={shelfLife} />}
                {minLifeReceival != null && (
                  <SpecRow label="Min Life on Receival" value={`${minLifeReceival} days`} />
                )}
              </SpecGrid>
              {rteLabel && (
                <div style={{
                  marginTop: "0.625rem",
                  padding: "0.625rem 0.875rem",
                  borderRadius: "0.375rem",
                  background: isRTE ? "#ecfdf5" : "#fef3c7",
                  border: `1px solid ${isRTE ? "#a7f3d0" : "#fcd34d"}`,
                  color: isRTE ? "#065f46" : "#92400e",
                  fontWeight: 700, fontSize: "0.8125rem", letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}>
                  {isRTE ? "* " : "! "}{rteLabel}
                </div>
              )}
              {heating && (
                <div style={{ marginTop: "0.625rem" }}>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.25rem" }}>
                    Heating Instructions
                  </div>
                  <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.375rem", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                    {heating}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Country of Origin */}
          {origin && (
            <div style={{ marginBottom: "1.25rem", breakInside: "avoid" }}>
              <SectionTitle>Country of Origin</SectionTitle>

              {/* v3: side-by-side row — left column is the FSC statement
                  (existing legacy block), right column is the new compliance
                  badge that always renders. */}
              <div style={{ display: "flex", gap: "1rem", alignItems: "stretch", flexWrap: "wrap" }}>
                <div style={{ flex: "2 1 320px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "0.375rem", padding: "0.875rem 1rem", fontSize: "0.875rem", color: "#166534", fontWeight: 600, lineHeight: 1.5 }}>
                  {origin}
                </div>
                {cooBreakdownLive?.localCountry && (
                  <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center" }}>
                    <CountryMark
                      country={cooBreakdownLive.localCountry}
                      adjective={cooBreakdownLive.localAdjective}
                      localPct={cooBreakdownLive.localPct}
                      size="md"
                    />
                  </div>
                )}
              </div>

              {/* Optional country breakdown — printed when the spec opted IN
                  via coo_show_breakdown. Per-ingredient breakdown stays
                  internal-only. */}
              {showCooBreakdown && cooBreakdownLive && cooBreakdownLive.byCountry.length > 0 && (
                <div style={{ marginTop: "0.75rem", padding: "0.75rem 1rem", border: "1px solid #e5e7eb", borderRadius: "0.375rem", background: "#ffffff" }}>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
                    Country breakdown
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.75rem", color: "#1c1917" }}>
                    {cooBreakdownLive.byCountry.map(row => (
                      <div key={row.country} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 22%) 1fr 56px", gap: "0.5rem", alignItems: "center" }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.country}</div>
                        <div style={{ height: "0.5rem", background: "#f3f4f6", borderRadius: "0.25rem", overflow: "hidden", border: "1px solid #e5e7eb" }}>
                          <div style={{
                            width: `${Math.min(100, Math.max(0, row.pct))}%`,
                            height: "100%",
                            background: row.country === cooBreakdownLive!.localCountry ? "#16a34a" : "#94a3b8",
                          }} />
                        </div>
                        <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.pct.toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                  {cooBreakdownLive.knownCoverage < 0.999 && (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.6875rem", color: "#78716c", fontStyle: "italic" }}>
                      Coverage: {Math.round(cooBreakdownLive.knownCoverage * 100)}% of ingredient mass has a declared country.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Microbiological Requirements (Tino May 2026):
              Render only when there's something to render. Operator entry
              wins; otherwise we bake the FSANZ Schedule-27 defaults when
              the item is RTE; otherwise the section is omitted. */}
          {microDisplay && (
            <div style={{ marginBottom: "1.25rem" }}>
              <SectionTitle>Microbiological Requirements</SectionTitle>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.375rem", padding: "0.875rem 1rem", fontSize: "0.8125rem", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {microDisplay}
              </div>
            </div>
          )}

          {/* Ingredients + Nutrition side-by-side (Tino May 7 v4)
              Wrapper keeps both blocks on the same page where possible —
              avoids the NIP table breaking awkwardly mid-row when a 1-page
              layout would have fit. Left column takes the wider share for
              the ingredients statement (which is naturally longer prose);
              right column gets the compact NIP table. */}
          <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginBottom: "1.25rem", breakInside: "avoid" }}>
            {ingredientsLine && (
              <div style={{ flex: "2 1 320px", minWidth: 0 }}>
                <SectionTitle>Ingredients</SectionTitle>
                <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.375rem", padding: "0.875rem 1rem", fontSize: "0.8125rem", lineHeight: 1.55 }}>
                  {ingredientsLine}
                </div>
              </div>
            )}
            {hasNutrition && (
            <div style={{ flex: "1 1 280px", minWidth: 0, breakInside: "avoid" }}>
              <SectionTitle>Nutrition Information</SectionTitle>
              <table style={{ borderCollapse: "collapse", fontSize: "0.75rem", width: "100%", border: "2px solid #1a1a1a" }}>
                <thead>
                  <tr style={{ background: "#1a1a1a", color: "#fff" }}>
                    <th colSpan={showServings ? 3 : 2} style={{ padding: "0.5rem 0.875rem", textAlign: "left", fontWeight: 700, fontSize: "0.875rem" }}>
                      NUTRITION INFORMATION
                    </th>
                  </tr>
                  {showServings && (
                    <tr style={{ background: "#f3f4f6" }}>
                      <td colSpan={3} style={{ padding: "0.375rem 0.875rem", fontSize: "0.75rem", color: "#374151", borderBottom: "1px solid #d1d5db" }}>
                        {isRandom
                          ? `Approx. servings per pack: ${servesPerPack} | Approx. serving size: ${fmtWeight(servingSizeG)}`
                          : `Servings per pack: ${servesPerPack} | Serving size: ${fmtWeight(servingSizeG)}`}
                      </td>
                    </tr>
                  )}
                  <tr style={{ background: "#f9fafb", borderBottom: "2px solid #1a1a1a" }}>
                    <th style={{ padding: "0.375rem 0.875rem", textAlign: "left", fontWeight: 700, fontSize: "0.6875rem", textTransform: "uppercase" }}>Nutrient</th>
                    {showServings && (
                      <th style={{ padding: "0.375rem 0.875rem", textAlign: "right", fontWeight: 700, fontSize: "0.6875rem", textTransform: "uppercase" }}>Per Serving</th>
                    )}
                    <th style={{ padding: "0.375rem 0.875rem", textAlign: "right", fontWeight: 700, fontSize: "0.6875rem", textTransform: "uppercase" }}>Per 100g</th>
                  </tr>
                </thead>
                <tbody>
                  {/* kJ only — kcal dropped from spec render per Tino May 2026.
                      Trans fat and Dietary Fibre rows also dropped. */}
                  <NutRow
                    label="Energy"
                    perServ={showServings ? (perServing(nutEnergyKj) ? `${perServing(nutEnergyKj)} kJ` : null) : null}
                    per100={nutEnergyKj ? `${nutEnergyKj} kJ` : null}
                    showServings={showServings}
                  />
                  <NutRow label="Protein"      perServ={showServings ? (perServing(nutProtein)     && `${perServing(nutProtein)} g`)     : null} per100={nutProtein     && `${nutProtein} g`}     showServings={showServings} />
                  <NutRow label="Total Fat"    perServ={showServings ? (perServing(nutFatTotal)    && `${perServing(nutFatTotal)} g`)    : null} per100={nutFatTotal    && `${nutFatTotal} g`}    showServings={showServings} />
                  <NutRow label="— Saturated"  perServ={showServings ? (perServing(nutFatSat)      && `${perServing(nutFatSat)} g`)      : null} per100={nutFatSat      && `${nutFatSat} g`}      showServings={showServings} indent />
                  <NutRow label="Carbohydrate" perServ={showServings ? (perServing(nutCarbsTotal)  && `${perServing(nutCarbsTotal)} g`)  : null} per100={nutCarbsTotal  && `${nutCarbsTotal} g`}  showServings={showServings} />
                  <NutRow label="— Sugars"     perServ={showServings ? (perServing(nutCarbsSugars) && `${perServing(nutCarbsSugars)} g`) : null} per100={nutCarbsSugars && `${nutCarbsSugars} g`} showServings={showServings} indent />
                  <NutRow label="Sodium"       perServ={showServings ? (perServing(nutSodium)      && `${perServing(nutSodium)} mg`)     : null} per100={nutSodium      && `${nutSodium} mg`}     showServings={showServings} />
                </tbody>
              </table>
              {/* Lab tested vs Theoretical disclaimer (Tino May 2026):
                  every published spec is honestly labelled. The flag lives
                  on product_specs.nutrition_lab_tested (mig 095). */}
              <div style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                fontStyle: "italic",
                color: labTested ? "#166534" : "#92400e",
                fontWeight: 600,
              }}>
                {labTested
                  ? "✓ Lab tested values."
                  : "⚠ Theoretical values — calculated from BOM weighted averages, not lab certified."}
              </div>
              {isLargeItem && (
                <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#6b7280", fontStyle: "italic" }}>
                  Per-serving values omitted for whole-muscle / random-weight item.
                </div>
              )}
            </div>
            )}
          </div>

          {/* Additional Notes (optional, operator-entered) */}
          {specNotes && (
            <div style={{ marginBottom: "1.25rem" }}>
              <SectionTitle>Additional Notes</SectionTitle>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.375rem", padding: "0.875rem 1rem", fontSize: "0.8125rem", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {specNotes}
              </div>
            </div>
          )}

        </div>

        {/* Company contact footer — Tino May 7 v4: in print mode this gets
            pinned to the bottom of every page via .spec-print-footer below.
            On screen it stays inline at the end of the page. */}
        <div className="spec-print-footer" style={{ borderTop: "2px solid #e5e7eb", padding: "1rem 2rem", background: "#fafafa", fontSize: "0.75rem", color: "#374151", lineHeight: 1.55 }}>
          <div style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
            {tenantLogo && (
              <img src={tenantLogo} alt={tenantName} style={{ maxHeight: "48px", maxWidth: "96px", objectFit: "contain", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: "0.8125rem", color: "#1a1a1a", marginBottom: "0.125rem" }}>
                {tenantName}
                {(tenant as any)?.abn && (
                  <span style={{ color: "#6b7280", fontWeight: 600, marginLeft: "0.5rem", fontSize: "0.75rem" }}>
                    ABN {(tenant as any).abn}
                  </span>
                )}
              </div>
              {addressLine && <div style={{ color: "#6b7280" }}>{addressLine}</div>}
              <div style={{ color: "#6b7280", display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.125rem" }}>
                {(tenant as any)?.company_phone && <span>Phone: {(tenant as any).company_phone}</span>}
                {(tenant as any)?.company_email && <span>Email: {(tenant as any).company_email}</span>}
              </div>
            </div>
            <div style={{ textAlign: "right", color: "#9ca3af", fontSize: "0.6875rem" }}>
              <div style={{ fontWeight: 700, color: "#374151" }}>{item?.name} | v{spec.version_label}</div>
              <div>Issue Date: {issueDate}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Small sub-components

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "0.6875rem", fontWeight: 800, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.625rem", paddingBottom: "0.25rem", borderBottom: "2px solid #fecaca" }}>
      {children}
    </div>
  );
}

function SpecGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "0.25rem 1rem" }}>
      {children}
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", padding: "0.3125rem 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6b7280", minWidth: "120px", flexShrink: 0 }}>{label}:</span>
      <span style={{ fontSize: "0.8125rem", color: "#1a1a1a", lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

function NutRow({ label, per100, perServ, showServings, indent }: {
  label: string;
  per100: string | null | false | undefined;
  perServ?: string | null | false | undefined;
  showServings: boolean;
  indent?: boolean;
}) {
  if (!per100) return null;
  return (
    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
      <td style={{ padding: "0.3rem 0.875rem", paddingLeft: indent ? "1.75rem" : "0.875rem", fontSize: "0.8125rem", color: indent ? "#6b7280" : "#1a1a1a", fontWeight: indent ? 400 : 500 }}>{label}</td>
      {showServings && (
        <td style={{ padding: "0.3rem 0.875rem", textAlign: "right", fontSize: "0.8125rem", color: "#1a1a1a", fontWeight: 600 }}>
          {perServ || ""}
        </td>
      )}
      <td style={{ padding: "0.3rem 0.875rem", textAlign: "right", fontSize: "0.8125rem", color: "#1a1a1a", fontWeight: 600 }}>{per100}</td>
    </tr>
  );
}
