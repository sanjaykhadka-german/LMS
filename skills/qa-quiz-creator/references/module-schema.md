# Training Module JSON Schema

## Top-level fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| moduleId | string | yes | e.g. "NC7" — use the NC number from the document |
| slug | string | yes | kebab-case: "nc7-pest-control" |
| title | string | yes | Plain-English title. Catchy, max ~8 words |
| subtitle | string | yes | One-liner. Often "Why X matters" or a direct statement |
| sqfClause | string | yes | e.g. "9.2.1.6" |
| trainingType | string | yes | Usually "Corrective Action / Refresher Training" |
| version | string | yes | "1.0" default |
| sourceDocument | string | yes | Original filename, e.g. "NC 7 Training.docx" |
| estimatedDurationMinutes | number | yes | Always 15 |
| passingScorePercent | number | yes | Always 80 |
| passThresholdText | string | yes | Always: "You need 80% or more to pass. Less than 80% means you'll need to do the quiz again." |
| keyTakeaway | string | yes | The big-idea sentence. Short and memorable. |
| keyPrinciple | string | no | Optional second memorable phrase (used in NC5, NC6) |
| summary | string | yes | 2–3 sentence summary of what the module covers |

## sections array

Each section is an object with at minimum `id`, `heading`, and `type` (type defaults to "default" if omitted).

### Section types

**default** — Standard content section. Can have any combination of:
```json
{
  "id": "what-a-label-needs",
  "heading": "What every label needs",
  "body": "Five things. That's it:",
  "bullets": ["Item one", "Item two"],
  "groups": [
    {
      "role": "You (operators)",
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
  "body": "The auditor found..."
}
```

**scenario** — A what-would-you-do question with a hidden answer.
```json
{
  "id": "scenario-1",
  "heading": "What would you do?",
  "type": "scenario",
  "body": "You see X. What's the right move?",
  "answerBody": "STOP – ISOLATE – REPORT. Steps here."
}
```

**takeaway** — The big-idea banner. Has `body` only.
```json
{
  "id": "big-idea",
  "heading": "The big idea",
  "type": "takeaway",
  "body": "No label? It doesn't exist."
}
```

## quiz object

```json
{
  "instructions": "10 quick questions. Get 8 or more right (80%) and you've passed...",
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
  "id": "nc7-q1",
  "type": "multiple_choice",
  "question": "In plain English, what does X mean?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": 1,
  "explanation": "Option B is correct because... (friendly, 1-2 sentences)"
}
```
- `correctAnswer` is the **zero-based index** (0, 1, 2, or 3) of the correct option
- Always exactly 4 options

### true_false question

```json
{
  "id": "nc7-q3",
  "type": "true_false",
  "question": "If the equipment looks clean, it's fine to skip the pre-op check.",
  "correctAnswer": false,
  "explanation": "No. Pre-op checks are required regardless of appearance."
}
```
- `correctAnswer` is a **boolean** — `true` or `false` (no quotes)
- No `options` field on true/false questions

## Minimal complete example

```json
{
  "moduleId": "NC7",
  "slug": "nc7-example",
  "title": "An Example Module",
  "subtitle": "Why this thing matters.",
  "sqfClause": "9.2.1.6",
  "trainingType": "Corrective Action / Refresher Training",
  "version": "1.0",
  "sourceDocument": "NC 7 Training.docx",
  "estimatedDurationMinutes": 15,
  "passingScorePercent": 80,
  "passThresholdText": "You need 80% or more to pass. Less than 80% means you'll need to do the quiz again.",
  "keyTakeaway": "If in doubt, stop and report.",
  "summary": "A short, plain-English summary of what this module is about and why it was created.",
  "sections": [
    {
      "id": "hook",
      "heading": "Why we're here today",
      "type": "story",
      "body": "The auditor found..."
    },
    {
      "id": "whats-this-about",
      "heading": "What's this about?",
      "body": "Plain English explanation..."
    },
    {
      "id": "big-idea",
      "heading": "The big idea",
      "type": "takeaway",
      "body": "If in doubt, stop and report."
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
        "id": "nc7-q1",
        "type": "multiple_choice",
        "question": "What did the auditor find?",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctAnswer": 1,
        "explanation": "Explanation here."
      },
      {
        "id": "nc7-q2",
        "type": "true_false",
        "question": "Statement here.",
        "correctAnswer": false,
        "explanation": "Explanation here."
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
