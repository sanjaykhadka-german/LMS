# Training Module JSON Schema

## Top-level fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| moduleId | string | yes | Short code from the source document (NC reference, SOP number, ticket ID, etc.). Use `"TBD"` if not in the document. |
| slug | string | yes | kebab-case, e.g. `"pre-shift-equipment-check"` |
| title | string | yes | Plain-English title. Catchy, max ~8 words |
| subtitle | string | yes | One-liner. Often "Why X matters" or a direct statement |
| sqfClause | string | yes | Any standard or clause reference — SQF, HACCP, ISO, OSHA, AS/NZS, GMP, internal SOP number. Don't rename the field; it carries whatever standard the source uses. `"TBD"` if not in the document. |
| trainingType | string | yes | One of: `"Corrective Action / Refresher Training"`, `"Procedure / Refresher Training"`, `"Policy Update"`, `"Induction / Onboarding"` |
| version | string | yes | `"1.0"` default |
| sourceDocument | string | yes | Original filename, e.g. `"Pre-shift Check SOP.docx"` |
| estimatedDurationMinutes | number | yes | Always `15` |
| passingScorePercent | number | yes | Always `80` |
| passThresholdText | string | yes | Always: `"You need 80% or more to pass. Less than 80% means you'll need to do the quiz again."` |
| keyTakeaway | string | yes | The big-idea sentence. Short and memorable. Must match the `body` of the `takeaway` section. |
| keyPrinciple | string | no | Optional second memorable phrase |
| summary | string | yes | 2–3 sentence summary of what the module covers |

## sections array

Each section is an object with at minimum `id`, `heading`, and `type` (`type` defaults to `"default"` if omitted).

### Section types

**default** — Standard content section. Can have any combination of `body`, `bullets`, and `groups`:
```json
{
  "id": "what-good-looks-like",
  "heading": "What good looks like",
  "body": "Three things, every time:",
  "bullets": ["Step one", "Step two", "Step three"],
  "groups": [
    {
      "role": "You (the operator / nurse / driver / etc.)",
      "bullets": ["Do this", "Do that"]
    }
  ]
}
```

**story** — The opening hook. Has `body` only (no bullets).
```json
{
  "id": "hook",
  "heading": "Why we're here today",
  "type": "story",
  "body": "Last Tuesday the supervisor walked through and found..."
}
```

**scenario** — A what-would-you-do question with a hidden answer.
```json
{
  "id": "scenario-1",
  "heading": "What would you do?",
  "type": "scenario",
  "body": "You start your shift and notice X. What's the right move?",
  "answerBody": "STOP – ISOLATE – REPORT. Walk through the steps here."
}
```

**takeaway** — The big-idea banner. Has `body` only.
```json
{
  "id": "big-idea",
  "heading": "The big idea",
  "type": "takeaway",
  "body": "If you didn't check it, don't start it."
}
```

## quiz object

```json
{
  "instructions": "10 quick questions. Get 8 or more right (80%) and you've passed. Less than that, you'll do the quiz again after a quick review.",
  "totalQuestions": 10,
  "passingScorePercent": 80,
  "pointsPerQuestion": 10,
  "totalPoints": 100,
  "shuffleQuestions": false,
  "questions": [...],
  "scoringRules": {
    "calculation": "(correctAnswers / totalQuestions) * 100",
    "passWhen": "scorePercent >= 80",
    "failWhen": "scorePercent < 80",
    "passMessage": "Well done — you scored {scorePercent}%. You've passed. Your result has been recorded.",
    "failMessage": "You got {scorePercent}%. You need 80% or more to pass. Have a quick look back through the training and give the quiz another go — you've got this.",
    "allowRetake": true,
    "maxAttempts": null
  }
}
```

### multiple_choice question

```json
{
  "id": "psc-q1",
  "type": "multiple_choice",
  "question": "Before you start the equipment, what's the first thing you do?",
  "options": [
    "Start it and see how it sounds",
    "Run through the pre-shift check sheet",
    "Wait for someone to tell you it's fine",
    "Skip it if the last shift used it"
  ],
  "correctAnswer": 1,
  "explanation": "Always run the pre-shift check first. The check sheet exists for a reason — past shifts don't cover you."
}
```
- `correctAnswer` is the **zero-based index** (0, 1, 2, or 3) of the correct option
- Always exactly 4 options

### true_false question

```json
{
  "id": "psc-q3",
  "type": "true_false",
  "question": "If the equipment looks clean, you can skip the pre-shift check.",
  "correctAnswer": false,
  "explanation": "No. Looks don't tell you about the wear, the calibration, or the last incident. Run the check anyway."
}
```
- `correctAnswer` is a **boolean** — `true` or `false` (no quotes)
- No `options` field on true/false questions

## Minimal complete example

A cross-industry pre-shift equipment check module. Use the same shape for any topic — incident response, hand hygiene, allergen control, dispensing checks, document control, vehicle inspections — by swapping the strings, not the structure.

```json
{
  "moduleId": "PSC-2026",
  "slug": "pre-shift-equipment-check",
  "title": "Pre-shift Equipment Checks",
  "subtitle": "Why we check before we start.",
  "sqfClause": "SOP-OPS-014",
  "trainingType": "Procedure / Refresher Training",
  "version": "1.0",
  "sourceDocument": "Pre-shift Check SOP.docx",
  "estimatedDurationMinutes": 15,
  "passingScorePercent": 80,
  "passThresholdText": "You need 80% or more to pass. Less than 80% means you'll need to do the quiz again.",
  "keyTakeaway": "If you didn't check it, don't start it.",
  "summary": "How to run the pre-shift equipment check, what to look for, and what to do when something fails.",
  "sections": [
    {
      "id": "hook",
      "heading": "Why we're here today",
      "type": "story",
      "body": "Last Tuesday the supervisor walked through at start of shift and found a machine running with no completed check sheet. Nobody could say who'd checked it. Nobody could say if anything was wrong. That's the gap this training closes."
    },
    {
      "id": "whats-this-about",
      "heading": "What's this about?",
      "body": "A quick refresher on the pre-shift check. What it is, when you do it, and what counts as 'done'."
    },
    {
      "id": "big-idea",
      "heading": "The big idea",
      "type": "takeaway",
      "body": "If you didn't check it, don't start it."
    }
  ],
  "quiz": {
    "instructions": "10 quick questions. Get 8 or more right (80%) and you've passed. Less than that, you'll do the quiz again after a quick review.",
    "totalQuestions": 10,
    "passingScorePercent": 80,
    "pointsPerQuestion": 10,
    "totalPoints": 100,
    "shuffleQuestions": false,
    "questions": [
      {
        "id": "psc-q1",
        "type": "multiple_choice",
        "question": "Before you start the equipment, what's the first thing you do?",
        "options": [
          "Start it and see how it sounds",
          "Run through the pre-shift check sheet",
          "Wait for someone to tell you it's fine",
          "Skip it if the last shift used it"
        ],
        "correctAnswer": 1,
        "explanation": "Always run the pre-shift check first. The check sheet exists for a reason."
      },
      {
        "id": "psc-q2",
        "type": "true_false",
        "question": "If the last shift signed off, you don't need to re-check.",
        "correctAnswer": false,
        "explanation": "Every shift checks. Conditions change between shifts and the sign-off is per-shift."
      }
    ],
    "scoringRules": {
      "calculation": "(correctAnswers / totalQuestions) * 100",
      "passWhen": "scorePercent >= 80",
      "failWhen": "scorePercent < 80",
      "passMessage": "Well done — you scored {scorePercent}%. You've passed. Your result has been recorded.",
      "failMessage": "You got {scorePercent}%. You need 80% or more to pass. Have a quick look back through the training and give the quiz another go — you've got this.",
      "allowRetake": true,
      "maxAttempts": null
    }
  }
}
```