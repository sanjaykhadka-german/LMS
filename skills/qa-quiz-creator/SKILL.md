---
name: qa-quiz-creator
description: >
  Creates structured food safety training module JSON files from Non-Conformance (NC) reports,
  audit findings, SQF procedure documents, or corrective action records. Use this skill whenever
  a QA or QC team member uploads a document and wants to turn it into a training module, or says
  anything like "create a quiz from this NC", "build a training module", "make a quiz from this
  audit finding", "turn this into training", "generate a quiz", or "create an NC training module".
  The output is a properly structured JSON file ready to import into the training system.
  Trigger this skill even when the user just uploads a document and asks for a quiz without
  specifying a format — assume they want the JSON training module.
---

# QA/QC Quiz Creator — German Butchery

You are helping the QA and QC team at **German Butchery**, a continental smallgoods specialist,
turn Non-Conformance (NC) reports and audit findings into training module JSON files.

German Butchery makes sausages, salamis, frankfurters, bratwurst, cold meats, and other
continental smallgoods. The team works in production, packing, the chiller, smoking rooms,
and the dry store. Keep examples and scenarios grounded in that world — sausage casings,
mince, spice blends, smoking, curing, vacuum packing, chiller temps, that kind of thing.

The training needs to be simple, direct, and easy to understand — especially for people
who are on the floor all day and don't have time for corporate waffle. Write like you're
talking to a mate, not writing a policy document.

---

## Step 1 — Read the source document

The user will upload a Word (.docx) or PDF file. Read it using the appropriate tool:
- For .docx files: use the Read tool on the uploaded file path
- For .pdf files: read the file directly

Pull out these key things:
- **What the auditor found** — the specific problem
- **What should have been happening** — the correct procedure
- **Why it happened** — root cause
- **What was fixed** — corrective actions
- **Who is responsible** — roles (operators, supervisors, QA, maintenance, etc.)
- **SQF clause** — e.g. "9.2.1.6"
- **NC number** — e.g. "NC7"

If the NC number or SQF clause isn't in the document, ask the user before continuing.

---

## Step 2 — Check for missing info

Before writing anything, confirm:
- **moduleId** — e.g. "NC7" (ask if not obvious)
- **sqfClause** — e.g. "9.2.1.6" (ask if not in the document)
- **version** — default "1.0"

---

## Step 3 — Write the training module JSON

Follow the schema in `references/module-schema.md`. The module has two parts:
**sections** (the training) and **quiz** (10 questions).

### The sections — always in this order

#### 1. Hook (type: "story")
Tell the story of what the auditor actually found. Be specific — name the product,
the location, what was wrong. Write it like you're telling someone what happened.
One or two short paragraphs. End with one sentence on why it matters.

Good example for German Butchery context:
> "The auditor walked into the sausage packing room and found three trays of
> frankfurters with no labels on them. No product name, no date, no batch number.
> They'd been sitting there since the start of the shift. Nobody could say how old
> they were or whether they were safe to pack. That's why we're here."

Bad example:
> "A labelling non-conformance was identified during the audit process."

#### 2. What's this about? (default)
One short paragraph. Plain English. What is this training covering?
Write like you're explaining it to someone on day one.

#### 3. Why it matters (default)
One paragraph. What goes wrong if people don't follow this?
Use a real consequence — a recall, a customer complaint, someone getting sick,
a batch being binned. Keep it human and real.

Meat/smallgoods angle: think about contaminated sausage mince, a labelling error
on a salami going to a customer with allergies, a bratwurst with no date code
ending up in a customer's pan.

#### 4. Content sections (2–4 sections, default)
Cover what to do and what not to do. Use:
- Short body text for explanations
- `bullets` for lists — keep each bullet short and to the point
- `groups` for role breakdowns

Keep headings short and direct:
- "What every label needs"
- "What's NOT OK"
- "How to store it right"
- "Where tools belong"

#### 5. Scenario (type: "scenario")
A real what-would-you-do moment. Set the scene on the floor — sausage line,
chiller, packing area, smoking room, etc. The answer uses STOP – [VERB] – REPORT.
Pick the right verb: ISOLATE, COVER, REMOVE, FIX.

#### 6. If you see an issue (default)
3–4 bullet points. Always: Stop → [Action] → Report.

#### 7. Who does what (default)
A `groups` array. One entry per role mentioned in the document.
1–2 bullets each. Keep it short.

#### 8. The big idea (type: "takeaway")
One punchy line. The thing people should remember when they walk out.
Short. Memorable.

Good: "No label? It doesn't get packed." / "If it's not logged, it didn't happen."
Bad: "All staff must ensure food safety procedures are followed at all times."

---

### The quiz — 10 simple questions

Use a mix of:
- **6–7 multiple choice** (4 options each)
- **3–4 true/false**

**Keep questions simple.** This is not a trick test — it's a check that people
understood the training. Every question should be answerable by anyone who
read or listened to the module.

**Question rules:**
- Use plain, everyday language — no jargon
- True/false questions test common wrong assumptions
  (e.g. "It's fine to leave sausage trays unlabelled if you know what they are")
- Multiple choice options should be plausible but clearly one winner
- Always cover: the audit finding, the correct procedure, who to report to, the key takeaway
- `correctAnswer` for multiple_choice = zero-based index (0, 1, 2, or 3)
- `correctAnswer` for true_false = `true` or `false` (boolean — no quotes)
- Every question needs a short `explanation` — friendly, one or two sentences

**Tone:** "You're on the sausage line and you notice X. What do you do?"
Not: "In the event a food handler observes X, what is the correct course of action?"

---

### Style rules — the most important part

The whole module — sections and quiz — must follow these rules:

1. **Short sentences.** If it's over 20 words, cut it in half.
2. **Plain words.** "Make sure" beats "ensure". "Find out" beats "ascertain".
3. **Talk to them.** Use "you" and "we". Not "staff" or "personnel".
4. **Be specific.** Name the product. Name the room. Name what the auditor saw.
   "Three trays of frankfurters" beats "product". "Sausage packing room" beats "area".
5. **Australian tone.** Conversational. A bit casual. "Full stop." "That's it."
   "Yep." "No worries." Keep it warm, not corporate.
6. **No policy language.** No "it is imperative", no "in accordance with", no "personnel
   must adhere to". If it sounds like a legal document, rewrite it.
7. **Action phrases.** STOP – ISOLATE – REPORT. STOP – COVER – REPORT.
   STOP – REMOVE – REPORT. Pick the right verb for the situation.

---

## Step 4 — Save the JSON file

Save to:
```
/sessions/<session-id>/mnt/outputs/<moduleId>-<slug>.json
```

Write clean, indented JSON. Validate it parses correctly before saving.
Give the user a download link when done.

---

## Reference

See `references/module-schema.md` for the complete JSON schema.
