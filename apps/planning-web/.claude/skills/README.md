# Project skills for Tracey

Drop-in skills Claude / Cowork can pick up when working in this repo.

## How to install (Cowork)

Cowork picks up `.claude/skills/<name>/SKILL.md` from the connected workspace
folder automatically. If your installation doesn't, copy the `jot` folder to
`%APPDATA%\Claude\skills\` (Windows) or `~/.claude/skills/` (macOS / Linux)
and restart the Cowork app.

## Skills available

- **`/jot <idea>`** — append a new idea to `tracey-master-plan.md` in the
  Captured Ideas section, stamped with today's date. Useful any time a
  strategic thought, feature request, or observation comes up that you
  don't want to lose. The receiving doc has full sections for vision,
  competitive landscape, must-build features, etc. — re-filing happens
  periodically.

## Adding more skills later

Same pattern: a folder under `.claude/skills/<your-skill>/` with a
`SKILL.md` containing front-matter (`name`, `description`) and the
instructions Claude follows. Keep one skill per folder.
