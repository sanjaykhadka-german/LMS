# Gunicorn auto-loads this file from the project root.
# Keep timeout generous enough for Claude/Gemini chat turns (which can
# run 30–90s with documents attached) to complete before the worker is
# killed. Render's default of 30s is far too short for this app.
timeout = 180
graceful_timeout = 30
workers = 2
keepalive = 5
