# ATO Stapled Super + TFN integration — research spike

> Status: **spike only**, not actioned. Captures what would be needed if/when
> Tracey decides to ship direct ATO integration. v1 of ShiftCraft onboarding
> ships without any ATO connector — super-fund details, if collected, are
> free-text fields for now.
>
> Date: 2026-05-14

## Scope of this research

Two pieces of the Deputy onboarding flow that touch the ATO:

1. **Stapled super fund lookup** — given a new employee's TFN + identity,
   return the existing super fund they should be paid into. Required for
   any new hire without a nominated fund so the employer can meet their
   choice-of-fund obligation under SGA s32(c).
2. **TFN declaration submission** — historically a separate ATO lodgement.
   **Already removed** under STP Phase 2: employers keep the TFN
   declaration in their own records and report tax-treatment info in the
   regular STP payevent.

Each is investigated below with what would be required to call it directly
versus go through an intermediary.

---

## 1. Stapled Super Fund API

**ATO product page**: [Stapled Super Fund | ATO API Portal](https://apiportal.ato.gov.au/api-products/stapled-super-fund)
**Endpoint reference**: [Stapled Super Fund API](https://apiportal.ato.gov.au/api-products/stapled-super-fund/stapled-super-fund-api)
**Test scenarios** (sandbox): [Stapled super fund API test scenarios](https://apiportal.ato.gov.au/api-products/stapled-super-fund/stapled-super-fund-api/test-scenarios)
**Employer-facing guide**: [Stapled super funds for employers](https://www.ato.gov.au/businesses-and-organisations/super-for-employers/setting-up-super-for-your-business/offer-employees-a-choice-of-super-fund/stapled-super-funds-for-employers)

### What the API does

Caller sends employer/intermediary details + employee identity (name, DOB,
TFN, address). Response returns one of eight reason codes ranging from
**Unmatched** to **Use default fund**, plus the matched fund details
(ABN, USI) when available. OAuth-style scope: `ato.super.stapledsuperfund.c,r`.

### Authentication

The public API portal page does not state the auth mechanism. Based on the
DSP framework, ATO digital wholesale services use **machine-to-machine
certificates** (M2M) — tied to a registered DSP, not to a user's myGovID.

### What we'd need before calling production

This is the gating cost. The Stapled Super Fund API sits behind the **DSP
Operational Security Framework** (OSF):

- [DSP Operational Security Framework](https://softwaredevelopers.ato.gov.au/operational_framework) — process overview
- [DSP OSF requirements PDF (v6.05)](https://softwaredevelopers.ato.gov.au/sites/default/files/2023-05/DSP_Operational_Security_Framework_Requirements_for_ATO_Digital_Services_v6.05.pdf) — the full controls list
- [DSP framework (ato.gov.au)](https://www.ato.gov.au/online-services/ato-digital-wholesale-services/digital-service-provider-operational-framework) — official policy page

Key requirements:

1. **DSP registration** — apply to the Digital Partnership Office (DPO).
2. **OSF questionnaire + evidence** — completed self-assessment against
   risk-scaled controls (authentication, encryption, logging, key
   management, breach reporting, data residency).
3. **OSF compliance letter** issued by the DPO before you can request
   production credentials. Annual self-review, full resubmission every
   2 years.
4. **TLS 1.3 mandatory** from **31 January 2026** for all interactions
   with ATO systems.
5. **Listing on the [Product Register](https://softwaredevelopers.ato.gov.au/product-register)** to advertise to customers.
6. **Recent advertising restriction**: "Superannuation software and
   onboarding providers are now prevented from advertising or promoting
   alternative super funds until they are also able to show information
   about any existing super accounts the employee may have so the employee
   can make an informed choice." — affects how the UI is allowed to
   present super-fund choice.

### Cost & lead time

ATO does not publish a price or timeline. From the DSPANZ / Lexology
write-ups and anecdotal reports, getting OSF-compliant is a **multi-month
effort** for a small SaaS (security policy work, infosec evidence
collection, often a third-party assessor). Once compliant, the API itself
is free to call. **Rough T-shirt: M to L** for a small team — dwarfs the
build cost of the integration itself.

### Sandbox

The test scenarios link above provides synthetic employee+TFN combinations
that exercise each of the eight reason codes. Sandbox access can be
requested without full OSF compliance — useful to validate request/response
shape before committing to the DSP track.

---

## 2. TFN declaration submission

**Short answer: not needed as a separate API call.**

From the ATO's STP Phase 2 guidance:

> Under STP Phase 2, you no longer have to send TFN declarations to the ATO.
> Your employees will still provide them to you, but you only need to keep
> them with your employee records.

Sources:
- [Expansion of STP (Phase 2) | ATO](https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/single-touch-payroll/in-detail/single-touch-payroll-phase-2-employer-reporting-guidelines/expansion-of-stp-phase-2)
- [How to report employment and tax information through STP Phase 2 | ATO](https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/single-touch-payroll/in-detail/single-touch-payroll-phase-2-employer-reporting-guidelines/how-to-report-employment-and-tax-information-through-stp-phase-2)

What this means for ShiftCraft:

- Capture the TFN declaration in our own forms + records (PDF retention).
- Encode the resulting tax-treatment as the **6-character tax treatment
  code** required by STP Phase 2 payevents.
- The code is reported as part of each STP submission — not separately.

So "submit TFN declaration to ATO" reduces to: **collect it, store it, and
emit the right tax-treatment code in STP**. If we're not running STP
ourselves, the answer is "pass the captured data downstream to whatever
payroll system is filing STP" — which is what Deputy does (see below).

---

## 3. How Deputy actually does it

From Deputy's own help centre and search results:

- Deputy [integrates with 35+ payroll partners](https://help.deputy.com/hc/en-au/articles/11947729498127-Submitting-the-pay-run-to-the-ATO-via-STP) (Xero, MYOB, ADP, QuickBooks, Employment Hero, etc.) — payroll partners are the registered DSPs that file STP.
- Deputy also runs its own **Deputy Payroll** product which lodges STP
  directly — this requires Deputy to be (and is) a registered DSP.
- The new "Deputy ATO integration" the user is referring to is most
  likely the Stapled Super lookup wired into the Deputy Payroll
  onboarding flow — only available because Deputy Payroll is the DSP.

**Implication for us**: if Tracey is willing to run its own payroll
product, direct ATO integration is on the table but expensive. If we'd
rather plug into an existing payroll DSP (Employment Hero, Xero Payroll,
etc.), we can offer the same UX (capture the TFN declaration, push to
payroll partner, partner does ATO submission) without DSP compliance work.

---

## 4. Recommendation for the roadmap

A direct ATO integration is **not the cheapest path** to the Deputy-style
onboarding UX. Three viable tracks, ranked by cost:

1. **Free-text capture only** *(today)*. ShiftCraft collects super fund,
   TFN, bank details as free-text/document upload. Operator emails the
   payroll team. **Cost: tiny.** UX gap: no stapled-fund lookup.

2. **Payroll-partner integration**. Pick one existing DSP (Employment Hero,
   Xero, KeyPay/Employment Innovations, etc.), build a one-way push from
   ShiftCraft onboarding → partner's onboarding API. Partner handles the
   stapled lookup + STP. **Cost: weeks of partner-specific dev.** UX gap:
   stapled lookup happens on the partner side, not in our UI.

3. **Direct ATO DSP**. Become a registered DSP, call Stapled Super API
   directly, integrate STP submission ourselves. **Cost: months of
   security/compliance + ongoing maintenance.** Unlocks: full in-product
   onboarding UX matching Deputy Payroll.

**Suggested next step**: **don't commit yet**. v1 ships path 1 (free text).
Before any further investment, validate which AU payroll product GB
already uses — that will determine whether path 2 (partner integration)
or path 3 (direct DSP) makes sense. Likely answer: integrate with whichever
payroll system the customer already runs, not become a DSP.

---

## Open questions for follow-up

- Which payroll provider does GB currently use? Determines whether path 2
  is viable and which partner to integrate with.
- Is there a downstream plan to build Tracey Payroll as a product? Only if
  yes does path 3 (DSP) make sense as a strategic investment.
- Has anyone on the team done OSF compliance before? Massive accelerator
  if so.
- What's the legal/advertising-restriction read on path 2 — if we route
  super-fund choice through a partner, do we still need to surface the
  employee's existing fund per the new ATO rule before promoting any
  default?

## Sources

- [Stapled Super Fund API portal](https://apiportal.ato.gov.au/api-products/stapled-super-fund/stapled-super-fund-api)
- [Stapled super funds — employer guide](https://www.ato.gov.au/businesses-and-organisations/super-for-employers/setting-up-super-for-your-business/offer-employees-a-choice-of-super-fund/stapled-super-funds-for-employers)
- [DSP Operational Security Framework overview](https://softwaredevelopers.ato.gov.au/operational_framework)
- [DSP OSF Requirements PDF v6.05](https://softwaredevelopers.ato.gov.au/sites/default/files/2023-05/DSP_Operational_Security_Framework_Requirements_for_ATO_Digital_Services_v6.05.pdf)
- [DSP framework on ato.gov.au](https://www.ato.gov.au/online-services/ato-digital-wholesale-services/digital-service-provider-operational-framework)
- [Expansion of STP Phase 2](https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/single-touch-payroll/in-detail/single-touch-payroll-phase-2-employer-reporting-guidelines/expansion-of-stp-phase-2)
- [Deputy STP help centre article](https://help.deputy.com/hc/en-au/articles/11947729498127-Submitting-the-pay-run-to-the-ATO-via-STP)
