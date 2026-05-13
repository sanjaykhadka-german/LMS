---
name: jot
description: Append a new idea or thought to the Tracey master plan (`tracey-master-plan.md`) in the "Captured ideas (unsorted)" section, stamped with today's date. Use whenever the user wants to quickly capture a strategic idea, observation, or todo without breaking flow. Trigger phrases include "/jot", "jot down", "add to master plan", "capture this idea", "remember this for the roadmap".
---

# Jot — quick idea capture for the Tracey master plan

When invoked, take whatever the user wrote after `/jot` (or whatever idea
they shared) and append it to `tracey-master-plan.md` in the
**"📥 Captured ideas (unsorted)"** section, stamped with today's date.

## What to do

1. Resolve today's date in `YYYY-MM-DD` format. If you're not sure of the
   date, run `date -u +%Y-%m-%d` via bash.

2. Find the master plan file. Try in order:
   - `tracey-master-plan.md` at the root of the user's connected workspace
     folder.
   - `./tracey-master-plan.md` from the current working directory.
   - If neither exists, ask the user for the path. Don't create the file
     yourself unless they confirm.

3. Read the file and locate the section header that starts with
   `## 8. 📥 Captured ideas (unsorted)` (or the closest match — the
   emoji and section number may shift over time, but "Captured ideas"
   will be in the heading).

4. Insert a new bullet **at the top of that section** (immediately after
   the section's intro blockquote, before any existing bullets). Format:

   ```
   - **[YYYY-MM-DD]** {user's idea verbatim, lightly cleaned up}
   ```

   Light cleanup means: trim whitespace, fix obvious typos if confident,
   capitalise the first letter. Do NOT reword for content. The user's
   words matter — they're going to re-read this in 6 months and need to
   recognise their own thinking.

5. If the user's input is empty or just punctuation, ask them what they'd
   like to capture. Don't add an empty bullet.

6. If the section still has the placeholder text `_(empty — the first jot
   is yours)_`, replace it with the new bullet rather than leaving the
   placeholder.

7. Save the file. Confirm to the user with one line — keep it warm but
   brief. Examples:
   - "Jotted. (under section 8)"
   - "Captured: '<first 6 words of idea>...' Saved to master plan."

## Edge cases

- If the user wants to file under a *specific* section (not "Captured
  ideas"), they'll usually say so explicitly, e.g. `/jot under Costing:
  ...`. In that case, find that section by header text and append at the
  end of it. Confirm which section in your reply.

- If the master plan file doesn't yet exist, tell the user "I don't see
  `tracey-master-plan.md` — should I create one?" rather than silently
  creating an empty file.

- The user may type `/jot` in a session where the workspace folder isn't
  mounted. In that case, ask them to share the folder.

## Why this skill exists

Tracey is a complex product. Strategic ideas come up mid-conversation —
sometimes about competition, sometimes about a feature, sometimes about a
customer pain point. Without a fast capture mechanism they evaporate. The
master plan is intentionally long-form so the full strategy is one read
away; this skill is the fast on-ramp so nothing gets lost between sessions.

The receiving doc itself (`tracey-master-plan.md`) explains the broader
structure: vision, beachhead, moats, competitive landscape, must-build
capabilities, open decisions, captured ideas. New jots periodically get
re-filed into the right structural section by Claude when asked to "tidy
up the master plan".
