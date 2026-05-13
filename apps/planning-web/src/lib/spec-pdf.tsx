/**
 * Product Specification PDF generator.
 *
 * Tino May 7 2026 rebuild: customer received a stripped-down PDF that
 * looked nothing like the on-screen preview at /specs/[id]/preview. This
 * rewrite mirrors that preview section-for-section so the attachment
 * matches what the operator approved on screen.
 */

import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";

export type SpecPdfData = {
  tenant: {
    name: string;
    abn: string | null;
    phone: string | null;
    email: string | null;
    addressLines: string[];
    brandColor: string;
    logoDataUri: string | null;
  };
  item: {
    code: string;
    name: string;
    barcode: string | null;
    perPieceG: number | null;
    piecesInner: number | null;
    piecesOuter: number | null;
    piecesPallet: number | null;
    outersPerPallet: number | null;
    isRandom: boolean;
    isRTE: boolean | null;
    isLargeItem: boolean;
  };
  versionLabel: string;
  status: "draft" | "approved";
  approvedAt: string | null;
  approverName: string | null;
  ingredientsStatement: string | null;
  allergens: string[];
  storageTemp: string | null;
  shelfLife: string | null;
  minLifeReceivalDays: number | null;
  rteLabel: string | null;
  heatingInstructions: string | null;
  countryOfOrigin: string | null;
  microRequirements: string | null;
  notes: string | null;
  nutrition: {
    energyKj: number | null;
    protein: number | null;
    fatTotal: number | null;
    fatSat: number | null;
    carbsTotal: number | null;
    carbsSugars: number | null;
    sodium: number | null;
    perServingG: number | null;
    showServings: boolean;
    servesPerPack: number | null;
    labTested: boolean;
  };
};

type DocumentProps = Parameters<typeof Document>[0];

const styles = StyleSheet.create({
  page: { fontSize: 9.5, fontFamily: "Helvetica", paddingTop: 0, paddingBottom: 40, paddingHorizontal: 0, color: "#1c1917" },
  brandStrip: { height: 4 },
  headerWrap: { paddingHorizontal: 32, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 2, borderBottomColor: "#1c1917" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: { flexDirection: "row", gap: 14, alignItems: "flex-start", flex: 1 },
  logoBox: { width: 56, height: 56 },
  logo: { width: 56, height: 56, objectFit: "contain" },
  tenantName: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  tenantLine: { fontSize: 8, color: "#57534e", lineHeight: 1.4 },
  metaBlock: { textAlign: "right", marginLeft: 12 },
  docTitle: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  docMeta: { fontSize: 8.5, color: "#57534e", marginTop: 3 },
  statusPill: { fontSize: 7.5, fontFamily: "Helvetica-Bold", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, marginTop: 5, alignSelf: "flex-end" },
  body: { paddingHorizontal: 32, paddingTop: 14 },
  itemTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#1c1917" },
  itemCode: { fontSize: 8.5, color: "#78716c", marginBottom: 12 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, color: "#1c1917", paddingBottom: 3, marginBottom: 6, borderBottomWidth: 1.2, borderBottomColor: "#b91c1c" },
  panel: { borderWidth: 0.5, borderColor: "#e5e7eb", backgroundColor: "#f9fafb", borderRadius: 3, padding: 8 },
  panelText: { fontSize: 9, lineHeight: 1.5, color: "#1c1917" },
  panelAllergen: { borderWidth: 0.5, borderColor: "#fecaca", backgroundColor: "#fef2f2", borderRadius: 3, padding: 8 },
  allergenLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#fee2e2", borderWidth: 0.5, borderColor: "#fecaca", borderRadius: 9, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#991b1b" },
  panelOrigin: { borderWidth: 0.5, borderColor: "#bbf7d0", backgroundColor: "#f0fdf4", borderRadius: 3, padding: 8 },
  panelOriginText: { fontSize: 9, lineHeight: 1.5, color: "#166534", fontFamily: "Helvetica-Bold" },
  kvGrid: { borderWidth: 0.5, borderColor: "#e5e7eb", borderRadius: 3 },
  kvRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#f3f4f6", paddingVertical: 4, paddingHorizontal: 8 },
  kvKey: { width: 120, fontSize: 7.5, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Helvetica-Bold", paddingRight: 6 },
  kvVal: { flex: 1, fontSize: 9, color: "#1c1917" },
  rteOk: { marginTop: 6, padding: 6, borderRadius: 3, backgroundColor: "#ecfdf5", borderWidth: 0.5, borderColor: "#a7f3d0", color: "#065f46", fontSize: 8.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  rteWarn: { marginTop: 6, padding: 6, borderRadius: 3, backgroundColor: "#fef3c7", borderWidth: 0.5, borderColor: "#fcd34d", color: "#92400e", fontSize: 8.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  subTitle: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 3 },
  nutTable: { borderWidth: 1.5, borderColor: "#1a1a1a" },
  nutHeadBand: { backgroundColor: "#1a1a1a", paddingHorizontal: 8, paddingVertical: 5 },
  nutHeadText: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 9.5, letterSpacing: 0.4 },
  nutServings: { backgroundColor: "#f3f4f6", paddingHorizontal: 8, paddingVertical: 4, fontSize: 8, color: "#374151", borderBottomWidth: 0.5, borderBottomColor: "#d1d5db" },
  nutColHead: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottomWidth: 1.5, borderBottomColor: "#1a1a1a" },
  nutColHeadCell: { paddingVertical: 4, paddingHorizontal: 8, fontFamily: "Helvetica-Bold", fontSize: 7, textTransform: "uppercase" },
  nutRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  nutCell: { paddingVertical: 4, paddingHorizontal: 8, fontSize: 9 },
  nutDisclaimer: { marginTop: 4, fontSize: 7.5, fontStyle: "italic" },
  // Tino May 7 v3: footer renders at the bottom of EVERY page (fixed) and
  // shows the page counter so multi-page specs are easy to follow.
  footer: { position: "absolute", bottom: 14, left: 32, right: 32, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: "#e7e5e4", flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#78716c" },
  footerLeft:  { fontSize: 7, color: "#78716c" },
  footerRight: { fontSize: 7, color: "#78716c", fontFamily: "Helvetica-Bold" },
});

function fmtN(n: number | null | undefined, dp = 1): string {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
function fmtWeight(g: number | null): string | null {
  if (g == null) return null;
  if (g >= 1000) return `${(g / 1000).toFixed(g >= 10000 ? 0 : 2)} kg`;
  return `${Math.round(g)} g`;
}
function perServingValue(per100: number | null, perServingG: number | null): number | null {
  if (per100 == null || perServingG == null) return null;
  return Math.round((per100 * perServingG / 100) * 10) / 10;
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{label}</Text>
      <Text style={styles.kvVal}>{value}</Text>
    </View>
  );
}

function NutRow({ label, per100, perServ, showServ, indent }: { label: string; per100: string | null; perServ: string | null; showServ: boolean; indent?: boolean }) {
  if (!per100) return null;
  const labelStyle = [styles.nutCell, { flex: 1, color: indent ? "#6b7280" : "#1c1917" }];
  const valStyle: ReturnType<typeof StyleSheet.create>[string] = [styles.nutCell, { width: 90, textAlign: "right" as const, fontFamily: "Helvetica-Bold" as const }];
  return (
    <View style={styles.nutRow}>
      <Text style={labelStyle}>{label}</Text>
      {showServ && <Text style={valStyle}>{perServ ?? ""}</Text>}
      <Text style={valStyle}>{per100}</Text>
    </View>
  );
}

export function ProductSpecPdf(data: SpecPdfData): ReactElement<DocumentProps> {
  const { tenant, item, versionLabel, status, approvedAt, approverName, ingredientsStatement, allergens, storageTemp, shelfLife, minLifeReceivalDays, rteLabel, heatingInstructions, countryOfOrigin, microRequirements, notes, nutrition } = data;
  const brand = tenant.brandColor || "#b91c1c";
  const statusBg = status === "approved" ? "#dcfce7" : "#fef3c7";
  const statusFg = status === "approved" ? "#166534" : "#854d0e";
  const showStorageSection = !!(storageTemp || shelfLife || minLifeReceivalDays != null || rteLabel || heatingInstructions);
  const showNutrition = !!(nutrition.energyKj || nutrition.protein || nutrition.fatTotal || nutrition.carbsTotal || nutrition.sodium);
  const ns = nutrition;
  const showServ = ns.showServings;
  const perServG = ns.perServingG ?? null;

  const E   = ns.energyKj    ? `${fmtN(ns.energyKj, 0)} kJ` : null;
  const P   = ns.protein     != null ? `${fmtN(ns.protein)} g`     : null;
  const FT  = ns.fatTotal    != null ? `${fmtN(ns.fatTotal)} g`    : null;
  const FS  = ns.fatSat      != null ? `${fmtN(ns.fatSat)} g`      : null;
  const CT  = ns.carbsTotal  != null ? `${fmtN(ns.carbsTotal)} g`  : null;
  const CS  = ns.carbsSugars != null ? `${fmtN(ns.carbsSugars)} g` : null;
  const Na  = ns.sodium      != null ? `${fmtN(ns.sodium, 0)} mg`  : null;
  const eS  = showServ && perServG != null ? perServingValue(ns.energyKj,    perServG) : null;
  const pS  = showServ && perServG != null ? perServingValue(ns.protein,     perServG) : null;
  const ftS = showServ && perServG != null ? perServingValue(ns.fatTotal,    perServG) : null;
  const fsS = showServ && perServG != null ? perServingValue(ns.fatSat,      perServG) : null;
  const ctS = showServ && perServG != null ? perServingValue(ns.carbsTotal,  perServG) : null;
  const csS = showServ && perServG != null ? perServingValue(ns.carbsSugars, perServG) : null;
  const naS = showServ && perServG != null ? perServingValue(ns.sodium,      perServG) : null;

  return (
    <Document title={`Spec - ${item.name} v${versionLabel}`}>
      <Page size="A4" style={styles.page}>
        <View style={[styles.brandStrip, { backgroundColor: brand }]} />
        <View style={styles.headerWrap}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              {tenant.logoDataUri && (
                <View style={styles.logoBox}>
                  <Image src={tenant.logoDataUri} style={styles.logo} />
                </View>
              )}
              <View>
                <Text style={styles.tenantName}>{tenant.name}</Text>
                {tenant.addressLines.filter(Boolean).map((l, i) => <Text key={i} style={styles.tenantLine}>{l}</Text>)}
                {tenant.abn   && <Text style={styles.tenantLine}>ABN: {tenant.abn}</Text>}
                {tenant.phone && <Text style={styles.tenantLine}>{tenant.phone}</Text>}
                {tenant.email && <Text style={styles.tenantLine}>{tenant.email}</Text>}
              </View>
            </View>
            <View style={styles.metaBlock}>
              <Text style={styles.docTitle}>PRODUCT SPECIFICATION</Text>
              <Text style={styles.docMeta}>Version {versionLabel}</Text>
              {approvedAt && <Text style={styles.docMeta}>Approved {fmtDate(approvedAt)}{approverName ? ` by ${approverName}` : ""}</Text>}
              <Text style={[styles.statusPill, { backgroundColor: statusBg, color: statusFg }]}>{status === "approved" ? "APPROVED" : "DRAFT"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.itemTitle}>{item.name}</Text>
          <Text style={styles.itemCode}>Code: {item.code}</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Product Identification</Text>
            <View style={styles.kvGrid}>
              <Kv label="Product Code" value={item.code} />
              {item.barcode && <Kv label="Barcode" value={item.barcode} />}
              {item.perPieceG != null && (
                <Kv label="Per Piece" value={item.isRandom ? `~${fmtWeight(item.perPieceG)} (indicative — actual weight printed on each label)` : (fmtWeight(item.perPieceG) ?? "—")} />
              )}
              {item.perPieceG != null && item.piecesInner != null && (
                <Kv label="Per Inner Pack" value={`${fmtWeight(item.perPieceG * item.piecesInner)} (${item.piecesInner} ${item.piecesInner === 1 ? "piece" : "pieces"})`} />
              )}
              {item.perPieceG != null && item.piecesOuter != null && (
                <Kv label="Per Outer / Carton" value={`${fmtWeight(item.perPieceG * item.piecesOuter)} (${item.piecesOuter} pieces)`} />
              )}
              {item.outersPerPallet != null && <Kv label="Outers per Pallet" value={String(item.outersPerPallet)} />}
              {item.perPieceG != null && item.piecesPallet != null && (
                <Kv label="Per Pallet" value={fmtWeight(item.perPieceG * item.piecesPallet) ?? "—"} />
              )}
            </View>
          </View>

          {ingredientsStatement && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Ingredients</Text>
              <View style={styles.panel}><Text style={styles.panelText}>{ingredientsStatement}</Text></View>
            </View>
          )}

          {allergens.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Allergen Declaration</Text>
              <View style={styles.panelAllergen}>
                <Text style={styles.allergenLabel}>Contains Allergens</Text>
                <View style={styles.chipRow}>
                  {allergens.map((a, i) => <Text key={i} style={styles.chip}>{a}</Text>)}
                </View>
              </View>
            </View>
          )}

          {showStorageSection && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Storage & Use</Text>
              <View style={styles.kvGrid}>
                {storageTemp && <Kv label="Storage Temperature" value={storageTemp} />}
                {shelfLife && <Kv label="Shelf Life from Manufacture" value={shelfLife} />}
                {minLifeReceivalDays != null && <Kv label="Min Life on Receival" value={`${minLifeReceivalDays} days`} />}
              </View>
              {rteLabel && <Text style={item.isRTE ? styles.rteOk : styles.rteWarn}>{item.isRTE ? "* " : "! "}{rteLabel}</Text>}
              {heatingInstructions && (
                <View>
                  <Text style={styles.subTitle}>Heating Instructions</Text>
                  <View style={styles.panel}><Text style={styles.panelText}>{heatingInstructions}</Text></View>
                </View>
              )}
            </View>
          )}

          {countryOfOrigin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Country of Origin</Text>
              <View style={styles.panelOrigin}><Text style={styles.panelOriginText}>{countryOfOrigin}</Text></View>
            </View>
          )}

          {microRequirements && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Microbiological Requirements</Text>
              <View style={styles.panel}><Text style={styles.panelText}>{microRequirements}</Text></View>
            </View>
          )}

          {showNutrition && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Nutrition Information</Text>
              <View style={styles.nutTable}>
                <View style={styles.nutHeadBand}><Text style={styles.nutHeadText}>NUTRITION INFORMATION</Text></View>
                {showServ && (
                  <Text style={styles.nutServings}>
                    {item.isRandom
                      ? `Approx. servings per pack: ${ns.servesPerPack ?? "—"} | Approx. serving size: ${fmtWeight(perServG)}`
                      : `Servings per pack: ${ns.servesPerPack ?? "—"} | Serving size: ${fmtWeight(perServG)}`}
                  </Text>
                )}
                <View style={styles.nutColHead}>
                  <Text style={[styles.nutColHeadCell, { flex: 1, color: "#374151" }]}>Nutrient</Text>
                  {showServ && <Text style={[styles.nutColHeadCell, { width: 90, textAlign: "right", color: "#374151" }]}>Per Serving</Text>}
                  <Text style={[styles.nutColHeadCell, { width: 90, textAlign: "right", color: "#374151" }]}>Per 100 g</Text>
                </View>
                <NutRow label="Energy"        per100={E}   perServ={eS  != null ? `${fmtN(eS,0)} kJ`  : null} showServ={showServ} />
                <NutRow label="Protein"       per100={P}   perServ={pS  != null ? `${fmtN(pS)} g`     : null} showServ={showServ} />
                <NutRow label="Total Fat"     per100={FT}  perServ={ftS != null ? `${fmtN(ftS)} g`    : null} showServ={showServ} />
                <NutRow label="— Saturated"   per100={FS}  perServ={fsS != null ? `${fmtN(fsS)} g`    : null} showServ={showServ} indent />
                <NutRow label="Carbohydrate"  per100={CT}  perServ={ctS != null ? `${fmtN(ctS)} g`    : null} showServ={showServ} />
                <NutRow label="— Sugars"      per100={CS}  perServ={csS != null ? `${fmtN(csS)} g`    : null} showServ={showServ} indent />
                <NutRow label="Sodium"        per100={Na}  perServ={naS != null ? `${fmtN(naS,0)} mg` : null} showServ={showServ} />
              </View>
              <Text style={[styles.nutDisclaimer, { color: ns.labTested ? "#166534" : "#92400e" }]}>
                {ns.labTested ? "* Lab tested values." : "! Theoretical values - calculated from BOM weighted averages, not lab certified."}
              </Text>
              {item.isLargeItem && <Text style={[styles.nutDisclaimer, { color: "#6b7280" }]}>Per-serving values omitted for whole-muscle / random-weight item.</Text>}
            </View>
          )}

          {notes && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Additional Notes</Text>
              <View style={styles.panel}><Text style={styles.panelText}>{notes}</Text></View>
            </View>
          )}
        </View>

        {/* Fixed footer — renders on every page when the spec spans more than
            one A4. Right side gives the operator a page counter. */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>{item.name} · v{versionLabel} · {tenant.name}</Text>
          <Text style={styles.footerRight} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderProductSpecPdfBuffer(data: SpecPdfData): Promise<Buffer> {
  return await renderToBuffer(<ProductSpecPdf {...data} />);
}
