import csv
import io
import json
import os
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, render_template, redirect, url_for, request,
                   flash, abort, send_from_directory, Response, session,
                   jsonify, current_app)
from flask_login import (LoginManager, login_user, logout_user,
                         login_required, current_user)
from werkzeug.utils import secure_filename
from sqlalchemy import or_, func
from sqlalchemy.exc import IntegrityError

from config import Config
from models import (db, User, Module, ModuleMedia, ContentItem,
                    ContentItemMedia, Question, Choice, Assignment, Attempt,
                    Department, Employer, Machine, UploadedFile, ModuleVersion,
                    AuditLog, DepartmentModulePolicy, WHSRecord, Position)
from email_service import (notify_invite, notify_assignment,
                           notify_attempt, notify_reminder,
                           notify_password_reset, notify_whs_expiry)
from ai_service import chat_turn, current_provider
from file_extract import (prepare_file, cleanup_local_files,
                          reap_old_files)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    db.init_app(app)

    login_manager = LoginManager()
    login_manager.login_view = "login"
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(uid):
        return db.session.get(User, int(uid))

    with app.app_context():
        db.create_all()
        ensure_schema_upgrades(app)
        backfill_missing_due_at()
        backfill_user_first_last()
        bootstrap_admin(app)

    @app.template_filter("fromjson")
    def fromjson_filter(s):
        if not s:
            return {}
        try:
            return json.loads(s)
        except (ValueError, TypeError):
            return {}

    @app.template_filter("media_kind")
    def media_kind_filter(p):
        return media_kind_for(p)

    register_routes(app)
    return app


def ensure_schema_upgrades(app):
    """Add columns to existing tables that db.create_all() won't touch.

    Each ALTER runs in its own transaction so a failure of one does not roll
    back the others. Works on SQLite (dev) and Postgres (prod)."""
    from sqlalchemy import inspect, text
    insp = inspect(db.engine)
    tables = set(insp.get_table_names())

    def col_exists(table, col):
        return table in tables and any(
            c["name"] == col for c in insp.get_columns(table)
        )

    upgrades = []
    if "users" in tables:
        if not col_exists("users", "phone"):
            upgrades.append(("users.phone",
                "ALTER TABLE users ADD COLUMN phone VARCHAR(30) DEFAULT ''"))
        if not col_exists("users", "department_id") and "departments" in tables:
            upgrades.append(("users.department_id",
                "ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id)"))
        if not col_exists("users", "first_name"):
            upgrades.append(("users.first_name",
                "ALTER TABLE users ADD COLUMN first_name VARCHAR(120) DEFAULT ''"))
        if not col_exists("users", "last_name"):
            upgrades.append(("users.last_name",
                "ALTER TABLE users ADD COLUMN last_name VARCHAR(120) DEFAULT ''"))
        if not col_exists("users", "employer_id") and "employers" in tables:
            upgrades.append(("users.employer_id",
                "ALTER TABLE users ADD COLUMN employer_id INTEGER REFERENCES employers(id)"))
        if not col_exists("users", "start_date"):
            upgrades.append(("users.start_date",
                "ALTER TABLE users ADD COLUMN start_date DATE"))
        if not col_exists("users", "termination_date"):
            upgrades.append(("users.termination_date",
                "ALTER TABLE users ADD COLUMN termination_date DATE"))
        if not col_exists("users", "photo_filename"):
            upgrades.append(("users.photo_filename",
                "ALTER TABLE users ADD COLUMN photo_filename VARCHAR(500)"))
        if not col_exists("users", "job_title"):
            upgrades.append(("users.job_title",
                "ALTER TABLE users ADD COLUMN job_title VARCHAR(120) DEFAULT ''"))
        if not col_exists("users", "manager_id"):
            upgrades.append(("users.manager_id",
                "ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id)"))
    if "machines" in tables:
        if not col_exists("machines", "department_id") and "departments" in tables:
            upgrades.append(("machines.department_id",
                "ALTER TABLE machines ADD COLUMN department_id INTEGER REFERENCES departments(id)"))
    # Re-introspect because positions is created by db.create_all() in this
    # same boot — without a fresh inspect call, get_table_names() would miss
    # it on the very first run after deploying this change.
    tables = set(inspect(db.engine).get_table_names())
    if "users" in tables and "positions" in tables:
        if not col_exists("users", "position_id"):
            upgrades.append(("users.position_id",
                "ALTER TABLE users ADD COLUMN position_id INTEGER REFERENCES positions(id)"))
    if "modules" in tables and not col_exists("modules", "created_by_id"):
        upgrades.append(("modules.created_by_id",
            "ALTER TABLE modules ADD COLUMN created_by_id INTEGER REFERENCES users(id)"))
    if "modules" in tables and not col_exists("modules", "cover_path"):
        upgrades.append(("modules.cover_path",
            "ALTER TABLE modules ADD COLUMN cover_path VARCHAR(500) DEFAULT ''"))
    if "modules" in tables and not col_exists("modules", "valid_for_days"):
        upgrades.append(("modules.valid_for_days",
            "ALTER TABLE modules ADD COLUMN valid_for_days INTEGER"))
    if "assignments" in tables and not col_exists("assignments", "version_id"):
        upgrades.append(("assignments.version_id",
            "ALTER TABLE assignments ADD COLUMN version_id INTEGER REFERENCES module_versions(id)"))

    for label, stmt in upgrades:
        try:
            with db.engine.begin() as conn:
                conn.execute(text(stmt))
            app.logger.warning("Schema upgrade applied: %s", label)
        except Exception as exc:
            app.logger.error("Schema upgrade FAILED for %s: %s", label, exc)


def parse_user_date(raw):
    """Accept blank, YYYY-MM-DD (HTML date input) or DD/MM/YYYY (AU CSV).
    Returns a date or None. Raises ValueError on a non-blank malformed value."""
    s = (raw or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unrecognised date: {s!r}")


def module_validity_days(module):
    """Effective expiry days for `module`. None = never expires.
    Module.valid_for_days: NULL → fall back to global ASSIGNMENT_VALIDITY_DAYS;
    0 → never expires; positive int → use as-is."""
    v = getattr(module, "valid_for_days", None) if module is not None else None
    if v is None:
        return current_app.config.get("ASSIGNMENT_VALIDITY_DAYS", 180)
    if v == 0:
        return None
    return v


def module_expiry_for(passed_at, module):
    """Datetime at which a passing attempt at `passed_at` expires; None = never."""
    if passed_at is None:
        return None
    days = module_validity_days(module)
    return None if days is None else passed_at + timedelta(days=days)


def compliance_status_for(latest_pass_dt, module, now, soon_days=30):
    """One of: 'never_passed' | 'current' | 'expiring_soon' | 'overdue'."""
    if latest_pass_dt is None:
        return "never_passed"
    expires = module_expiry_for(latest_pass_dt, module)
    if expires is None:
        return "current"
    if expires < now:
        return "overdue"
    if expires < now + timedelta(days=soon_days):
        return "expiring_soon"
    return "current"


def assignment_due_from(dt, module=None):
    """Due date for an assignment assigned at `dt`. With `module`, uses
    Module.valid_for_days; otherwise falls back to ASSIGNMENT_VALIDITY_DAYS.
    Returns None when the module never expires."""
    days = (module_validity_days(module) if module is not None
            else current_app.config.get("ASSIGNMENT_VALIDITY_DAYS", 180))
    return None if days is None else dt + timedelta(days=days)


def user_machine_competencies(user, now=None):
    """For each machine assigned to the user, summarise whether they're
    qualified to operate it based on currently-passed module attempts.

    Returns a list of {machine, modules, overall} dicts where overall is
    one of 'qualified' | 'partial' | 'pending' | 'no_training_required'.
    Reuses compliance_status_for so the matrix and competency view stay
    in sync about what counts as 'current'."""
    if now is None:
        now = datetime.utcnow()
    last_pass = {
        r.module_id: r.ts for r in db.session.query(
            Attempt.module_id,
            func.max(Attempt.created_at).label("ts"),
        ).filter(Attempt.user_id == user.id, Attempt.passed.is_(True))
         .group_by(Attempt.module_id).all()
    }
    out = []
    for machine in user.machines:
        per_module = []
        current_count = 0
        for m in machine.modules:
            ts = last_pass.get(m.id)
            status = compliance_status_for(ts, m, now)
            per_module.append({"module": m, "status": status,
                               "last_pass": ts})
            if status == "current":
                current_count += 1
        if not machine.modules:
            overall = "no_training_required"
        elif current_count == len(machine.modules):
            overall = "qualified"
        elif current_count == 0:
            overall = "pending"
        else:
            overall = "partial"
        out.append({"machine": machine, "modules": per_module,
                    "overall": overall})
    return out


def auto_assign_for_department(user, base_url=None, send_email=True):
    """Create Assignment rows for any DepartmentModulePolicy modules the user
    isn't already assigned to. Idempotent — relies on uq_user_module to skip
    duplicates. Commits its own transaction. Returns count of rows created."""
    if user.department_id is None:
        return 0
    policy_module_ids = {
        r.module_id for r in DepartmentModulePolicy.query
        .filter_by(department_id=user.department_id).all()
    }
    if not policy_module_ids:
        return 0
    existing = {
        a.module_id for a in Assignment.query
        .filter_by(user_id=user.id).all()
    }
    to_create = policy_module_ids - existing
    if not to_create:
        return 0
    now = datetime.utcnow()
    created = 0
    new_assignments = []
    for mid in to_create:
        m = db.session.get(Module, mid)
        if m is None or not m.is_published:
            continue
        a = Assignment(user_id=user.id, module_id=mid,
                       assigned_at=now,
                       due_at=assignment_due_from(now, module=m))
        db.session.add(a)
        new_assignments.append((a, m))
        created += 1
    if not created:
        return 0
    try:
        db.session.commit()
    except IntegrityError:
        # Concurrent insert produced a duplicate via uq_user_module — rare
        # but possible if two admins act simultaneously. Recover by
        # rolling back; the row already exists, so the goal is met.
        db.session.rollback()
        return 0
    for a, m in new_assignments:
        try:
            log_audit("auto_assign", "assignment", a.id,
                      f"Auto-assigned '{m.title}' to {user.email} "
                      f"via department '{user.department.name}'")
        except Exception:
            current_app.logger.exception("auto-assign audit log failed")
        if send_email and base_url:
            try:
                notify_assignment(user, m, base_url)
            except Exception:
                current_app.logger.exception(
                    "auto-assign email failed for %s", user.email)
    db.session.commit()
    return created


def backfill_user_first_last():
    """Split legacy User.name into first_name / last_name on first space.
    Only touches rows whose first_name is still empty so we don't clobber
    edited names. Trailing parts collapse into last_name."""
    rows = User.query.filter((User.first_name == "") | (User.first_name.is_(None))).all()
    if not rows:
        return
    changed = 0
    for u in rows:
        full = (u.name or "").strip()
        if not full:
            continue
        parts = full.split(None, 1)
        u.first_name = parts[0]
        u.last_name = parts[1] if len(parts) > 1 else ""
        changed += 1
    if changed:
        db.session.commit()


def backfill_missing_due_at():
    """Populate due_at on legacy Assignment rows where it is NULL."""
    rows = Assignment.query.filter(Assignment.due_at.is_(None)).all()
    if not rows:
        return
    days = current_app.config.get("ASSIGNMENT_VALIDITY_DAYS", 180)
    for a in rows:
        base = a.assigned_at or datetime.utcnow()
        a.due_at = base + timedelta(days=days)
    db.session.commit()


def process_expired_completions(base_url):
    """Reset assignments whose completion is older than the module's validity
    window. Called lazily from admin_assignments GET. Returns count reset.
    Each module's own valid_for_days governs its expiry; modules with
    valid_for_days=0 never expire."""
    rows = (Assignment.query
            .filter(Assignment.completed_at.isnot(None)).all())
    now = datetime.utcnow()
    reset = 0
    for a in rows:
        expires = module_expiry_for(a.completed_at, a.module)
        if expires is None or expires >= now:
            continue
        a.completed_at = None
        a.assigned_at = now
        a.due_at = assignment_due_from(now, module=a.module)
        try:
            notify_assignment(a.user, a.module, base_url)
        except Exception:
            current_app.logger.exception(
                "expiry refresher email failed for assignment %s", a.id)
        reset += 1
    if reset:
        db.session.commit()
    return reset


def whs_status_for(record, now=None):
    """Return one of 'current' | 'expiring_soon' | 'overdue' | 'no_expiry'
    for a WHS record. Incidents always return 'no_expiry'."""
    if record.kind == "incident" or record.expires_on is None:
        return "no_expiry"
    today = (now or datetime.utcnow()).date()
    days_to_expiry = (record.expires_on - today).days
    if days_to_expiry < 0:
        return "overdue"
    if days_to_expiry <= WHS_REMINDER_LOOKAHEAD_DAYS:
        return "expiring_soon"
    return "current"


def process_whs_reminders(base_url, force=False):
    """Send reminder emails for WHS records expiring within
    WHS_REMINDER_LOOKAHEAD_DAYS that haven't been reminded in the last
    WHS_REMINDER_COOLDOWN_DAYS. Mirrors process_expired_completions —
    called lazily on admin dashboard load + manually via the WHS landing
    'Send today's reminders now' button.

    Returns count sent. `force=True` ignores the cooldown."""
    today = datetime.utcnow().date()
    horizon = today + timedelta(days=WHS_REMINDER_LOOKAHEAD_DAYS)
    cooldown_cutoff = (datetime.utcnow()
                       - timedelta(days=WHS_REMINDER_COOLDOWN_DAYS))

    q = (WHSRecord.query
         .filter(WHSRecord.kind != "incident")
         .filter(WHSRecord.user_id.isnot(None))
         .filter(WHSRecord.expires_on.isnot(None))
         .filter(WHSRecord.expires_on <= horizon))
    if not force:
        q = q.filter(db.or_(
            WHSRecord.last_reminded_at.is_(None),
            WHSRecord.last_reminded_at < cooldown_cutoff,
        ))

    sent = 0
    for r in q.all():
        u = r.user
        if u is None or not u.is_active_flag:
            continue
        try:
            ok = notify_whs_expiry(u, r,
                                   WHS_KIND_SINGULAR.get(r.kind, "WHS record"),
                                   base_url)
        except Exception:
            current_app.logger.exception(
                "WHS reminder email failed for record %s", r.id)
            ok = False
        if ok:
            r.last_reminded_at = datetime.utcnow()
            sent += 1
    if sent:
        db.session.commit()
    return sent


def bootstrap_admin(app):
    """Create a bootstrap admin user the first time the app boots against
    an empty database. Never modifies an existing admin — passwords are
    changed only via the UI (self-service change-password or admin-initiated
    reset for other users)."""
    if User.query.filter_by(role="admin").first():
        return

    admin_email = app.config.get("ADMIN_EMAIL") or "admin@example.com"
    temp_pw = secrets.token_urlsafe(9)
    admin = User(email=admin_email, name="Administrator", role="admin")
    admin.set_password(temp_pw)
    db.session.add(admin)
    db.session.commit()
    app.logger.warning("=" * 60)
    app.logger.warning("BOOTSTRAP ADMIN CREATED")
    app.logger.warning("Email: %s", admin_email)
    app.logger.warning("Temporary password: %s", temp_pw)
    app.logger.warning("Change it immediately after first login.")
    app.logger.warning("=" * 60)


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("login"))
        if not current_user.is_admin:
            abort(403)
        return fn(*args, **kwargs)
    return wrapper


def log_audit(action, entity_type, entity_id=None, summary="", details=None):
    """Append an AuditLog row. Caller commits via the existing
    db.session.commit(). Errors are swallowed so audit failures never break
    the originating action."""
    try:
        actor_id = (current_user.id
                    if current_user.is_authenticated else None)
        actor_email = (current_user.email
                       if current_user.is_authenticated else "")
        actor_name = (current_user.name
                      if current_user.is_authenticated else "")
        ip_raw = (request.headers.get("X-Forwarded-For",
                                      request.remote_addr or "") or "")
        ip = ip_raw.split(",")[0].strip()[:64]
        ua = (request.headers.get("User-Agent") or "")[:255]
        row = AuditLog(
            user_id=actor_id,
            actor_email=actor_email,
            actor_name=actor_name,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=(summary or "")[:500],
            details_json=json.dumps(details) if details else "",
            ip_address=ip,
            user_agent=ua,
        )
        db.session.add(row)
    except Exception:
        current_app.logger.exception("audit log append failed")


def author_required(fn):
    """Admin or QA/QC — anyone who can author modules and manage assignments."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("login"))
        if not current_user.can_author:
            abort(403)
        return fn(*args, **kwargs)
    return wrapper


def qaqc_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("login"))
        if not current_user.is_qaqc:
            abort(403)
        return fn(*args, **kwargs)
    return wrapper


VALID_ROLES = ("admin", "qaqc", "employee")

# WHS register kinds. Each value is also a route segment, so keep these
# url-safe (lowercase, underscores, no spaces).
WHS_KINDS = ("high_risk_licence", "fire_warden", "first_aider", "incident")
WHS_KIND_LABEL = {
    "high_risk_licence": "High-risk licences",
    "fire_warden": "Fire wardens",
    "first_aider": "First aiders",
    "incident": "Incidents & near-misses",
}
WHS_KIND_SINGULAR = {
    "high_risk_licence": "High-risk licence",
    "fire_warden": "Fire warden",
    "first_aider": "First aider",
    "incident": "Incident / near-miss",
}
WHS_SEVERITIES = ("low", "medium", "high", "critical")
# Don't email the same WHS record more than once every 14 days, even if the
# admin keeps reloading the dashboard.
WHS_REMINDER_COOLDOWN_DAYS = 14
# Send a reminder when the licence/warden/first-aider expires within this
# many days. Mirrors the module-compliance "expiring_soon" 30-day window.
WHS_REMINDER_LOOKAHEAD_DAYS = 30


def get_or_create_employer(name):
    """Look up an Employer by name (case-sensitive match like Department),
    create it if missing. Caller is responsible for db.session.commit().
    Returns None for blank input."""
    name = (name or "").strip()
    if not name:
        return None
    emp = Employer.query.filter_by(name=name).first()
    if not emp:
        emp = Employer(name=name)
        db.session.add(emp)
        db.session.flush()
    return emp


def get_or_create_department(name):
    """Same idea as get_or_create_employer for departments."""
    name = (name or "").strip()
    if not name:
        return None
    dept = Department.query.filter_by(name=name).first()
    if not dept:
        dept = Department(name=name)
        db.session.add(dept)
        db.session.flush()
    return dept


def allowed_file(filename):
    return ("." in filename
            and filename.rsplit(".", 1)[1].lower() in Config.ALLOWED_EXTENSIONS)


IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}
VIDEO_EXTS = {"mp4", "mov", "webm"}
AUDIO_EXTS = {"mp3", "wav", "m4a", "ogg"}
PDF_EXTS = {"pdf"}
DOC_EXTS = {"doc", "docx", "txt", "md"}


def media_kind_for(path):
    if not path:
        return ""
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in PDF_EXTS:
        return "pdf"
    if ext in DOC_EXTS:
        return "doc"
    return ""


MAX_PERSISTED_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per module/section upload


def save_upload(fs, prefix=""):
    """Persist a werkzeug FileStorage into the uploaded_files table so it
    survives Render's ephemeral filesystem. Returns the stored filename
    (used as the PK and in URLs via /uploads/<name>).
    Raises ValueError if the extension is not in ALLOWED_EXTENSIONS or
    the file exceeds MAX_PERSISTED_FILE_BYTES."""
    name = secure_filename(fs.filename or "")
    if not name or not allowed_file(name):
        raise ValueError("Unsupported file type.")
    ext = name.rsplit(".", 1)[1].lower()
    stored = f"{prefix}{secrets.token_hex(8)}.{ext}"

    blob = fs.read()
    if len(blob) > MAX_PERSISTED_FILE_BYTES:
        mb = MAX_PERSISTED_FILE_BYTES // (1024 * 1024)
        raise ValueError(f"File too large ({len(blob) // (1024*1024)} MB). Max {mb} MB.")

    mime = fs.mimetype or "application/octet-stream"
    uploader_id = None
    try:
        from flask_login import current_user as _cu
        if _cu and _cu.is_authenticated:
            uploader_id = int(_cu.get_id())
    except Exception:
        uploader_id = None

    uf = UploadedFile(filename=stored, mime_type=mime,
                      data=blob, size=len(blob),
                      uploaded_by_id=uploader_id)
    db.session.add(uf)
    db.session.commit()
    return stored


def set_user_photo(user, file_storage):
    """Persist a new profile photo and delete the previous one.
    Returns the new stored filename. Raises ValueError on bad upload."""
    new_name = save_upload(file_storage, prefix="photo_")
    old = user.photo_filename
    user.photo_filename = new_name
    if old and old != new_name:
        prev = db.session.get(UploadedFile, old)
        if prev is not None:
            db.session.delete(prev)
    return new_name


def clear_user_photo(user):
    old = user.photo_filename
    user.photo_filename = None
    if old:
        prev = db.session.get(UploadedFile, old)
        if prev is not None:
            db.session.delete(prev)


def build_module_snapshot(m):
    """Capture the editable surface of a module as a JSON-friendly dict.
    Used by ModuleVersion to pin a user's training to a specific revision."""
    return {
        "title": m.title,
        "description": m.description,
        "is_published": m.is_published,
        "cover_path": m.cover_path,
        "media_items": [{"id": x.id, "kind": x.kind, "file_path": x.file_path}
                        for x in m.media_items],
        "content_items": [{
            "id": ci.id, "kind": ci.kind, "title": ci.title,
            "body": ci.body, "file_path": ci.file_path,
            "position": ci.position,
            "media_items": [{"id": x.id, "kind": x.kind, "file_path": x.file_path}
                            for x in ci.media_items],
        } for ci in m.content_items],
        "questions": [{
            "id": q.id, "kind": q.kind, "prompt": q.prompt, "position": q.position,
            "choices": [{"id": c.id, "text": c.text, "is_correct": c.is_correct}
                        for c in q.choices],
        } for q in m.questions],
    }


def hydrate_module_view(snapshot, live_module=None):
    """Wrap a snapshot in a SimpleNamespace tree so module/quiz templates
    can iterate it like a live Module. live_module supplies the real id
    so url_for('my_quiz', module_id=...) keeps working."""
    from types import SimpleNamespace as NS
    questions = [NS(id=q["id"], kind=q["kind"], prompt=q["prompt"],
                    position=q.get("position", 0),
                    choices=[NS(**c) for c in q["choices"]])
                 for q in snapshot.get("questions", [])]
    content_items = [NS(id=ci["id"], kind=ci["kind"], title=ci["title"],
                        body=ci["body"], file_path=ci.get("file_path", ""),
                        position=ci.get("position", 0),
                        media_items=[NS(**x) for x in ci.get("media_items", [])])
                     for ci in snapshot.get("content_items", [])]
    return NS(
        id=live_module.id if live_module is not None else None,
        title=snapshot.get("title", ""),
        description=snapshot.get("description", ""),
        is_published=snapshot.get("is_published", True),
        cover_path=snapshot.get("cover_path", ""),
        media_items=[NS(**x) for x in snapshot.get("media_items", [])],
        content_items=content_items, questions=questions,
    )


def module_for_assignment(a):
    """Return the module shape a user should see — pinned snapshot if set,
    otherwise the live module."""
    if a.version_id and a.version is not None:
        try:
            snap = json.loads(a.version.snapshot_json)
            return hydrate_module_view(snap, live_module=a.module)
        except (ValueError, TypeError):
            pass
    return a.module


def score_attempt(module, answers):
    """Return (correct, total, percent) given a dict of question_id -> list[choice_id]."""
    total = len(module.questions)
    if total == 0:
        return 0, 0, 0
    correct = 0
    for q in module.questions:
        submitted = set(int(c) for c in answers.get(str(q.id), []))
        correct_ids = {c.id for c in q.choices if c.is_correct}
        if submitted == correct_ids and correct_ids:
            correct += 1
    percent = int(round(correct * 100 / total))
    return correct, total, percent


def attempt_review(module, answers):
    """Per-question review for the result page. Same `answers` shape as
    score_attempt — {qid_str: [choice_id_str, ...]}. Returns a list of
    {question, chosen, correct, is_right} for each question in order."""
    review = []
    for q in module.questions:
        raw = answers.get(str(q.id), []) or []
        try:
            chosen_ids = {int(c) for c in raw if str(c).strip().isdigit()}
        except (TypeError, ValueError):
            chosen_ids = set()
        chosen_choices = [c for c in q.choices if c.id in chosen_ids]
        correct_choices = [c for c in q.choices if c.is_correct]
        correct_ids = {c.id for c in correct_choices}
        is_right = bool(correct_ids) and chosen_ids == correct_ids
        review.append({
            "question": q,
            "chosen": chosen_choices,
            "correct": correct_choices,
            "is_right": is_right,
        })
    return review


# Rich content block kinds that can live in ContentItem.kind.
# story / takeaway hold plain prose in `body`; scenario / section hold JSON.
RICH_KINDS = {"story", "scenario", "takeaway", "section"}


def _module_description_from(mod):
    """Build Module.description from subtitle/summary/keyTakeaway."""
    parts = []
    if mod.get("subtitle"):
        parts.append(mod["subtitle"])
    if mod.get("summary"):
        parts.append(mod["summary"])
    if mod.get("keyTakeaway"):
        parts.append("Key takeaway: " + mod["keyTakeaway"])
    return "\n\n".join(parts)


def _section_kind_and_body(s):
    """Map an AI-spec section dict to (kind, title, body) for ContentItem."""
    stype = (s.get("type") or "section").lower()
    if stype not in RICH_KINDS:
        stype = "section"
    heading = (s.get("heading") or "").strip() or "Section"
    if stype in ("story", "takeaway"):
        body = s.get("body") or ""
    elif stype == "scenario":
        body = json.dumps({
            "body": s.get("body") or "",
            "answerBody": s.get("answerBody") or "",
        })
    else:  # section
        body = json.dumps({
            "body": s.get("body") or "",
            "bullets": s.get("bullets") or [],
            "groups": s.get("groups") or [],
        })
    return stype, heading, body


def _add_question_with_choices(module_id, qpos, q):
    """Insert one Question + its Choices from an AI-spec question dict.
    No-ops on empty prompts. Caller flushes/commits."""
    if not isinstance(q, dict):
        return
    prompt = (q.get("question") or "").strip()
    if not prompt:
        return
    qobj = Question(module_id=module_id, prompt=prompt,
                    kind="single", position=qpos)
    db.session.add(qobj)
    db.session.flush()

    qtype = (q.get("type") or "multiple_choice").lower()
    if qtype == "true_false":
        correct_val = q.get("correctAnswer")
        for cpos, (label, val) in enumerate([("True", True), ("False", False)]):
            db.session.add(Choice(
                question_id=qobj.id, text=label,
                is_correct=(val == correct_val), position=cpos,
            ))
    else:
        options = q.get("options") or []
        correct_idx = q.get("correctAnswer")
        for cpos, opt in enumerate(options):
            db.session.add(Choice(
                question_id=qobj.id, text=str(opt),
                is_correct=(cpos == correct_idx), position=cpos,
            ))


def import_module_from_json(data, user_id):
    """Create Module + ContentItems + Questions + Choices from preview-style JSON.

    `data` may be a single module dict or a list of module dicts.
    Caller is responsible for the outer commit/rollback.
    Raises ValueError with a user-friendly message on bad input.
    """
    if isinstance(data, dict):
        payload = [data]
    elif isinstance(data, list):
        payload = data
    else:
        raise ValueError("JSON must be an object, or an array of objects.")

    created = []
    for i, mod in enumerate(payload, start=1):
        if not isinstance(mod, dict):
            raise ValueError(f"Module #{i}: expected a JSON object.")
        title = (mod.get("title") or "").strip()
        if not title:
            raise ValueError(f"Module #{i}: missing required 'title' field.")

        m = Module(title=title,
                   description=_module_description_from(mod),
                   is_published=True, created_by_id=user_id)
        db.session.add(m)
        db.session.flush()

        for pos, s in enumerate(mod.get("sections") or []):
            if not isinstance(s, dict):
                continue
            kind, heading, body = _section_kind_and_body(s)
            db.session.add(ContentItem(
                module_id=m.id, kind=kind,
                title=heading, body=body, position=pos,
            ))

        quiz = mod.get("quiz") or {}
        for qpos, q in enumerate(quiz.get("questions") or []):
            _add_question_with_choices(m.id, qpos, q)

        created.append(m)

    return created


def apply_module_json_to_existing(module, data):
    """Merge AI-generated module spec into an existing Module.

    Module title/description: overwritten.
    Sections: positional merge — update existing ContentItem's kind/title/body
      in place (preserves file_path + media_items); append new ones for excess;
      leave extras alone if AI returned fewer sections.
    Questions: wipe-and-replace (cascade kills Choices). Attempts FK Module
      only, so historical attempts survive.

    Raises ValueError on bad input. Caller commits/rolls back.
    """
    if not isinstance(data, dict):
        raise ValueError("Expected a single module object.")
    title = (data.get("title") or "").strip()
    if not title:
        raise ValueError("Module is missing a 'title' field.")

    module.title = title
    module.description = _module_description_from(data)

    new_sections = [s for s in (data.get("sections") or []) if isinstance(s, dict)]
    existing = list(module.content_items)  # ordered by position via relationship
    for i, s in enumerate(new_sections):
        kind, heading, body = _section_kind_and_body(s)
        if i < len(existing):
            ci = existing[i]
            ci.kind = kind
            ci.title = heading
            ci.body = body
            ci.position = i
            # file_path and media_items left untouched on purpose.
        else:
            db.session.add(ContentItem(
                module_id=module.id, kind=kind,
                title=heading, body=body, position=i,
            ))
    # Trailing existing sections (beyond what AI returned) are left alone.

    # Questions — replace wholesale. Cascade delete-orphan handles Choices.
    for q in list(module.questions):
        db.session.delete(q)
    db.session.flush()
    quiz = data.get("quiz") or {}
    for qpos, q in enumerate(quiz.get("questions") or []):
        _add_question_with_choices(module.id, qpos, q)


def build_compliance_context(scope_user_ids, scope_module_ids, now=None):
    """Roll up training compliance for the given user/module scope.

    Two bulk queries (passing attempts + assignments), then group in Python.
    Returns: by_module list, retrain_users list (top 10), and two KPI scalars.
    Empty scope returns zeros — the dashboard renders cleanly on a fresh DB."""
    if not scope_user_ids or not scope_module_ids:
        return {
            "by_module": [],
            "retrain_users": [],
            "kpi_expiring_30d": 0,
            "kpi_users_overdue": 0,
        }

    now = now or datetime.utcnow()

    assignments = (Assignment.query
                   .filter(Assignment.user_id.in_(scope_user_ids))
                   .filter(Assignment.module_id.in_(scope_module_ids))
                   .all())
    passes = (Attempt.query
              .filter(Attempt.passed.is_(True))
              .filter(Attempt.user_id.in_(scope_user_ids))
              .filter(Attempt.module_id.in_(scope_module_ids))
              .order_by(Attempt.created_at.desc())
              .all())

    latest = {}
    for ap in passes:
        key = (ap.user_id, ap.module_id)
        if key not in latest:
            latest[key] = ap.created_at

    modules_by_id = {m.id: m for m in Module.query
                     .filter(Module.id.in_(scope_module_ids)).all()}

    per_module = {}
    per_user = {}
    for assn in assignments:
        m = modules_by_id.get(assn.module_id)
        if m is None:
            continue
        status = compliance_status_for(
            latest.get((assn.user_id, assn.module_id)), m, now)
        pm = per_module.setdefault(m.id, {
            "id": m.id, "title": m.title, "total_assigned": 0,
            "current": 0, "expiring": 0, "overdue": 0, "never_passed": 0,
        })
        pm["total_assigned"] += 1
        if status == "current":
            pm["current"] += 1
        elif status == "expiring_soon":
            pm["expiring"] += 1
        elif status == "overdue":
            pm["overdue"] += 1
        else:
            pm["never_passed"] += 1

        pu = per_user.setdefault(assn.user_id, {
            "id": assn.user_id, "overdue_count": 0, "expiring_count": 0,
        })
        if status == "overdue":
            pu["overdue_count"] += 1
        elif status == "expiring_soon":
            pu["expiring_count"] += 1

    by_module = sorted(per_module.values(),
                       key=lambda r: (r["overdue"] + r["expiring"]),
                       reverse=True)
    for r in by_module:
        denom = r["total_assigned"] or 1
        r["pct_current"] = round(100 * r["current"] / denom)

    user_rows = [u for u in per_user.values()
                 if u["overdue_count"] or u["expiring_count"]]
    user_rows.sort(key=lambda u: (u["overdue_count"], u["expiring_count"]),
                   reverse=True)
    user_rows = user_rows[:10]
    if user_rows:
        names = {u.id: u.name for u in User.query
                 .filter(User.id.in_([r["id"] for r in user_rows])).all()}
        for r in user_rows:
            r["name"] = names.get(r["id"], "—")

    return {
        "by_module": by_module,
        "retrain_users": user_rows,
        "kpi_expiring_30d": sum(r["expiring"] for r in by_module),
        "kpi_users_overdue": sum(1 for u in per_user.values()
                                 if u["overdue_count"] > 0),
    }


def build_dashboard_context():
    """Compute the metrics shown on admin and QA/QC dashboards.

    Reads the optional `from`, `to`, `dept`, `module` query-string filters and
    returns a context dict ready for `render_template(**ctx)`."""
    from collections import defaultdict

    today = datetime.utcnow().date()
    default_from = today - timedelta(days=29)

    def _parse_date(s, default):
        if not s:
            return default
        try:
            return datetime.strptime(s, "%Y-%m-%d").date()
        except ValueError:
            return default

    from_date = _parse_date(request.args.get("from"), default_from)
    to_date = _parse_date(request.args.get("to"), today)
    if to_date < from_date:
        from_date, to_date = to_date, from_date

    dept_id = request.args.get("dept", type=int)
    module_id = request.args.get("module", type=int)

    start_ts = datetime.combine(from_date, datetime.min.time())
    end_ts = datetime.combine(to_date, datetime.min.time()) + timedelta(days=1)

    attempts_q = Attempt.query.filter(
        Attempt.created_at >= start_ts,
        Attempt.created_at < end_ts,
    )
    if module_id:
        attempts_q = attempts_q.filter(Attempt.module_id == module_id)
    if dept_id:
        attempts_q = (attempts_q
                      .join(User, User.id == Attempt.user_id)
                      .filter(User.department_id == dept_id))
    attempts = attempts_q.all()

    assignments_q = Assignment.query
    if module_id:
        assignments_q = assignments_q.filter(Assignment.module_id == module_id)
    if dept_id:
        assignments_q = (assignments_q
                         .join(User, User.id == Assignment.user_id)
                         .filter(User.department_id == dept_id))
    assignments_in_scope = assignments_q.all()

    total_attempts = len(attempts)
    pass_count = sum(1 for a in attempts if a.passed)
    pass_rate = (100.0 * pass_count / total_attempts) if total_attempts else 0.0
    avg_score = (sum(a.score or 0 for a in attempts) / total_attempts) if total_attempts else 0.0
    active_learners = len({a.user_id for a in attempts})

    now = datetime.utcnow()
    soon_threshold = now + timedelta(days=7)
    statuses = {"completed": 0, "overdue": 0, "due_soon": 0, "not_started": 0}
    for assn in assignments_in_scope:
        if assn.completed_at:
            statuses["completed"] += 1
        elif assn.due_at and assn.due_at < now:
            statuses["overdue"] += 1
        elif assn.due_at and assn.due_at < soon_threshold:
            statuses["due_soon"] += 1
        else:
            statuses["not_started"] += 1
    total_assignments_scoped = len(assignments_in_scope)
    completion_rate = (100.0 * statuses["completed"] / total_assignments_scoped
                       ) if total_assignments_scoped else 0.0

    per_day = defaultdict(lambda: {"passed": 0, "failed": 0})
    for a in attempts:
        d = a.created_at.date()
        per_day[d]["passed" if a.passed else "failed"] += 1
    days_labels, days_passed, days_failed = [], [], []
    cur = from_date
    while cur <= to_date:
        days_labels.append(cur.isoformat())
        days_passed.append(per_day[cur]["passed"])
        days_failed.append(per_day[cur]["failed"])
        cur += timedelta(days=1)

    per_module = defaultdict(lambda: {"attempts": 0, "passed": 0})
    for a in attempts:
        per_module[a.module_id]["attempts"] += 1
        if a.passed:
            per_module[a.module_id]["passed"] += 1
    mod_ids = list(per_module.keys())
    mod_titles = {}
    if mod_ids:
        for m in Module.query.filter(Module.id.in_(mod_ids)).all():
            mod_titles[m.id] = m.title
    by_module = []
    for mid, s in per_module.items():
        rate = (100.0 * s["passed"] / s["attempts"]) if s["attempts"] else 0.0
        title = mod_titles.get(mid, f"Module {mid}")
        by_module.append({
            "id": mid,
            "title": title,
            "attempts": s["attempts"],
            "passed": s["passed"],
            "rate": round(rate, 1),
        })
    by_module.sort(key=lambda x: x["rate"])

    user_ids = list({a.user_id for a in attempts})
    user_dept = {}
    learner_names = {}
    if user_ids:
        for u in User.query.filter(User.id.in_(user_ids)).all():
            user_dept[u.id] = u.department_id
            learner_names[u.id] = u.name
    dept_names = {None: "(no department)"}
    for d in Department.query.all():
        dept_names[d.id] = d.name
    per_dept = defaultdict(lambda: {"attempts": 0, "passed": 0})
    for a in attempts:
        did = user_dept.get(a.user_id)
        per_dept[did]["attempts"] += 1
        if a.passed:
            per_dept[did]["passed"] += 1
    by_dept = []
    for did, s in per_dept.items():
        rate = (100.0 * s["passed"] / s["attempts"]) if s["attempts"] else 0.0
        by_dept.append({
            "name": dept_names.get(did, "(unknown)"),
            "attempts": s["attempts"],
            "rate": round(rate, 1),
        })
    by_dept.sort(key=lambda x: -x["rate"])

    per_learner = defaultdict(lambda: {"attempts": 0, "score_sum": 0, "passed": 0})
    for a in attempts:
        row = per_learner[a.user_id]
        row["attempts"] += 1
        row["score_sum"] += a.score or 0
        if a.passed:
            row["passed"] += 1
    top_learners = []
    for uid, row in per_learner.items():
        avg = row["score_sum"] / row["attempts"] if row["attempts"] else 0
        top_learners.append({
            "id": uid,
            "name": learner_names.get(uid, f"User {uid}"),
            "attempts": row["attempts"],
            "avg_score": round(avg, 1),
            "passed": row["passed"],
        })
    top_learners.sort(key=lambda x: (-x["avg_score"], -x["attempts"]))
    top_learners = top_learners[:5]

    worst_modules = sorted(
        [m for m in by_module if m["attempts"] > 0],
        key=lambda x: (x["rate"], -x["attempts"]),
    )[:5]

    recent = (Attempt.query.order_by(Attempt.created_at.desc())
              .limit(10).all())

    # Compliance scope: active employees only (no ex-staff), narrowed by the
    # current dept filter; modules narrowed by the module filter if present.
    user_scope_q = User.query.filter(User.role == "employee",
                                     User.is_active_flag.is_(True),
                                     User.termination_date.is_(None))
    if dept_id:
        user_scope_q = user_scope_q.filter(User.department_id == dept_id)
    scope_user_ids = [u.id for u in user_scope_q.with_entities(User.id).all()]

    module_scope_q = Module.query
    if module_id:
        module_scope_q = module_scope_q.filter(Module.id == module_id)
    scope_module_ids = [m.id for m in module_scope_q.with_entities(Module.id).all()]

    compliance = build_compliance_context(scope_user_ids, scope_module_ids, now)

    stats = {
        "modules": Module.query.count(),
        "employees": User.query.filter_by(role="employee").count(),
        "assignments": Assignment.query.count(),
        "attempts": Attempt.query.count(),
        "window_attempts": total_attempts,
        "pass_rate": round(pass_rate, 1),
        "avg_score": round(avg_score, 1),
        "active_learners": active_learners,
        "overdue": statuses["overdue"],
        "completion_rate": round(completion_rate, 1),
        "expiring_30d": compliance["kpi_expiring_30d"],
        "users_overdue": compliance["kpi_users_overdue"],
    }

    chart_data = {
        "timeseries": {
            "labels": days_labels,
            "passed": days_passed,
            "failed": days_failed,
        },
        "status": {
            "labels": ["Completed", "Overdue", "Due soon (≤7d)", "Not started"],
            "values": [statuses["completed"], statuses["overdue"],
                       statuses["due_soon"], statuses["not_started"]],
        },
        "by_module": {
            "labels": [(m["title"][:40] + "…") if len(m["title"]) > 40
                       else m["title"] for m in by_module],
            "full_titles": [m["title"] for m in by_module],
            "rates": [m["rate"] for m in by_module],
            "attempts": [m["attempts"] for m in by_module],
        },
        "by_dept": {
            "labels": [d["name"] for d in by_dept],
            "rates": [d["rate"] for d in by_dept],
            "attempts": [d["attempts"] for d in by_dept],
        },
    }

    return {
        "stats": stats,
        "recent": recent,
        "chart_data": chart_data,
        "top_learners": top_learners,
        "worst_modules": worst_modules,
        "filters": {
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
            "dept": dept_id,
            "module": module_id,
        },
        "departments": Department.query.order_by(Department.name).all(),
        "all_modules": Module.query.order_by(Module.title).all(),
        "compliance": compliance,
    }


def register_routes(app):

    @app.route("/")
    def index():
        if current_user.is_authenticated:
            if current_user.is_admin:
                return redirect(url_for("admin_dashboard"))
            if current_user.is_qaqc:
                return redirect(url_for("qaqc_dashboard"))
            return redirect(url_for("my_modules"))
        return redirect(url_for("login"))

    # --- PWA: service worker + manifest served from root scope ---
    # Render's CDN/proxy will otherwise cache the service worker for hours,
    # breaking updates. The headers below force a re-fetch each time and
    # let the SW control the entire site (Service-Worker-Allowed: /).
    @app.route('/sw.js')
    def service_worker():
        response = send_from_directory(app.static_folder, 'sw.js')
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Service-Worker-Allowed'] = '/'
        response.headers['Content-Type'] = 'application/javascript'
        return response

    @app.route('/manifest.json')
    def web_manifest():
        response = send_from_directory(app.static_folder, 'manifest.json')
        response.headers['Content-Type'] = 'application/manifest+json'
        response.headers['Cache-Control'] = 'public, max-age=3600'
        return response

    # --- auth ---
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            user = User.query.filter_by(email=email).first()
            if user and user.is_active_flag and user.check_password(password):
                login_user(user)
                return redirect(url_for("index"))
            flash("Invalid email or password.", "danger")
        return render_template("login.html")

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        return redirect(url_for("login"))

    @app.route("/profile", methods=["GET", "POST"])
    @login_required
    def profile():
        u = current_user
        if request.method == "POST":
            kind = request.form.get("form_type", "")
            if kind == "info":
                first = request.form.get("first_name", "").strip()
                last  = request.form.get("last_name", "").strip()
                phone = request.form.get("phone", "").strip()
                missing = [n for n, v in
                           (("First name", first), ("Last name", last), ("Phone", phone))
                           if not v]
                if missing:
                    flash("Missing required field(s): " + ", ".join(missing), "danger")
                else:
                    u.first_name = first
                    u.last_name = last
                    u.name = f"{first} {last}".strip()
                    u.phone = phone
                    photo_fs = request.files.get("photo")
                    if photo_fs and (photo_fs.filename or "").strip():
                        try:
                            set_user_photo(u, photo_fs)
                        except ValueError as exc:
                            db.session.rollback()
                            flash(f"Photo not saved: {exc}", "danger")
                            return redirect(url_for("profile"))
                    elif request.form.get("remove_photo"):
                        clear_user_photo(u)
                    log_audit("update", "user", u.id,
                              f"Self-edited profile for {u.email}")
                    db.session.commit()
                    flash("Profile updated.", "success")
                return redirect(url_for("profile"))
            if kind == "password":
                old = request.form.get("old", "")
                new = request.form.get("new", "")
                confirm = request.form.get("confirm", "")
                if not u.check_password(old):
                    flash("Current password is incorrect.", "danger")
                elif len(new) < 8:
                    flash("New password must be at least 8 characters.", "danger")
                elif new != confirm:
                    flash("Passwords do not match.", "danger")
                else:
                    u.set_password(new)
                    log_audit("password_change", "user", u.id,
                              f"Self-changed password for {u.email}")
                    db.session.commit()
                    flash("Password updated.", "success")
                return redirect(url_for("profile"))
        return render_template("profile.html", user=u)

    @app.route("/change-password")
    @login_required
    def change_password():
        # Back-compat redirect — old bookmarks and any url_for('change_password')
        # call sites still resolve to the new combined profile page.
        return redirect(url_for("profile"))

    # --- admin ---
    @app.route("/admin")
    @admin_required
    def admin_dashboard():
        # Fire WHS reminder emails for licences/wardens/first-aiders expiring
        # in the next 30 days. Cooldown'd to once per record per 14 days, so
        # repeated dashboard loads don't spam staff. Same lazy pattern as
        # process_expired_completions on /admin/assignments.
        try:
            process_whs_reminders(app.config.get("APP_BASE_URL", ""))
        except Exception:
            current_app.logger.exception("WHS reminder sweep failed")
        ctx = build_dashboard_context()
        ctx["whs_expiring"] = _whs_expiring_soon_for_dashboard()
        return render_template("admin/dashboard.html", **ctx)

    # --- qa/qc ---
    @app.route("/qaqc")
    @qaqc_required
    def qaqc_dashboard():
        ctx = build_dashboard_context()
        return render_template("qaqc/dashboard.html", **ctx)

    @app.route("/admin/org-chart")
    @author_required
    def admin_org_chart():
        """Render the org chart from the Position tree. Each card shows the
        position name plus the active staff currently filling it."""
        positions = (Position.query
                     .options(db.joinedload(Position.department))
                     .order_by(Position.sort_order, Position.name).all())
        children_of = {p.id: [] for p in positions}
        roots = []
        for p in positions:
            if p.parent_id and p.parent_id in children_of:
                children_of[p.parent_id].append(p)
            else:
                roots.append(p)

        # Bulk load active users grouped by position to avoid N+1s.
        users = (User.query.filter_by(is_active_flag=True)
                 .filter(User.position_id.isnot(None))
                 .order_by(User.last_name, User.first_name).all())
        users_by_position = {}
        for u in users:
            users_by_position.setdefault(u.position_id, []).append(u)

        # Active users with no position assigned — shown in a separate
        # "Unassigned" panel so they don't disappear from the chart.
        unassigned = (User.query.filter_by(is_active_flag=True,
                                           position_id=None)
                      .order_by(User.last_name, User.first_name).all())

        return render_template("admin/org_chart.html",
                               roots=roots, children_of=children_of,
                               users_by_position=users_by_position,
                               unassigned=unassigned,
                               total_positions=len(positions))

    @app.route("/admin/positions", methods=["GET", "POST"])
    @author_required
    def admin_positions():
        """List + create page for org-chart positions."""
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            parent_raw = request.form.get("parent_id", "").strip()
            dept_raw = request.form.get("department_id", "").strip()
            if not name:
                flash("Position name is required.", "danger")
                return redirect(url_for("admin_positions"))
            parent_id = int(parent_raw) if parent_raw.isdigit() else None
            dept_id = int(dept_raw) if dept_raw.isdigit() else None
            p = Position(name=name, parent_id=parent_id,
                         department_id=dept_id)
            db.session.add(p)
            db.session.flush()
            log_audit("create", "position", p.id,
                      f"Created position '{p.name}'")
            db.session.commit()
            flash(f"Position '{name}' added.", "success")
            return redirect(url_for("admin_positions"))

        positions = (Position.query
                     .options(db.joinedload(Position.department))
                     .order_by(Position.sort_order, Position.name).all())
        children_of = {p.id: [] for p in positions}
        roots = []
        for p in positions:
            if p.parent_id and p.parent_id in children_of:
                children_of[p.parent_id].append(p)
            else:
                roots.append(p)
        # Headcount per position for the list display.
        headcount = {p.id: 0 for p in positions}
        for u in User.query.filter(User.position_id.isnot(None),
                                   User.is_active_flag.is_(True)).all():
            headcount[u.position_id] = headcount.get(u.position_id, 0) + 1
        departments = Department.query.order_by(Department.name).all()
        return render_template("admin/positions.html",
                               positions=positions, roots=roots,
                               children_of=children_of,
                               headcount=headcount,
                               departments=departments)

    @app.route("/admin/positions/<int:pid>/edit", methods=["GET", "POST"])
    @author_required
    def admin_position_edit(pid):
        p = db.session.get(Position, pid) or abort(404)
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            parent_raw = request.form.get("parent_id", "").strip()
            dept_raw = request.form.get("department_id", "").strip()
            if not name:
                flash("Position name is required.", "danger")
                return redirect(url_for("admin_position_edit", pid=pid))
            new_parent_id = int(parent_raw) if parent_raw.isdigit() else None
            # Reject self-as-parent and direct-child-as-parent (1-level
            # circular check; deeper cycles are unlikely in practice).
            if new_parent_id == p.id:
                flash("A position can't be its own parent.", "warning")
                new_parent_id = p.parent_id
            elif new_parent_id is not None:
                candidate = db.session.get(Position, new_parent_id)
                if candidate is not None and candidate.parent_id == p.id:
                    flash(f"'{candidate.name}' already reports to "
                          f"'{p.name}' — choose a different parent.",
                          "warning")
                    new_parent_id = p.parent_id
            p.name = name
            p.parent_id = new_parent_id
            p.department_id = int(dept_raw) if dept_raw.isdigit() else None
            log_audit("update", "position", p.id,
                      f"Updated position '{p.name}'")
            db.session.commit()
            flash(f"Position '{p.name}' updated.", "success")
            return redirect(url_for("admin_positions"))
        positions = Position.query.order_by(Position.name).all()
        departments = Department.query.order_by(Department.name).all()
        return render_template("admin/position_edit.html",
                               position=p, positions=positions,
                               departments=departments)

    @app.route("/admin/positions/<int:pid>/delete", methods=["POST"])
    @author_required
    def admin_position_delete(pid):
        p = db.session.get(Position, pid) or abort(404)
        # Reparent children to this position's parent so they don't orphan.
        Position.query.filter_by(parent_id=p.id).update(
            {"parent_id": p.parent_id})
        # Users assigned to this position get position_id set to NULL via
        # the FK ondelete action (they appear in "Unassigned" on the chart).
        log_audit("delete", "position", p.id,
                  f"Deleted position '{p.name}'")
        db.session.delete(p)
        db.session.commit()
        flash(f"Position '{p.name}' deleted. Children re-parented; "
              "any staff assigned to it are now unassigned.", "success")
        return redirect(url_for("admin_positions"))

    @app.route("/admin/matrix")
    @author_required
    def admin_training_matrix():
        """Compliance matrix: rows=users, cols=modules, cells coloured by
        compliance_status_for. Filterable by department/employer; CSV-exportable."""
        dept_id = request.args.get("dept_id", type=int)
        employer_id = request.args.get("employer_id", type=int)
        fmt = (request.args.get("format") or "").lower()

        users_q = (User.query
                   .filter(User.is_active_flag == True)  # noqa: E712
                   .options(db.joinedload(User.department),
                            db.joinedload(User.employer)))
        if dept_id:
            users_q = users_q.filter(User.department_id == dept_id)
        if employer_id:
            users_q = users_q.filter(User.employer_id == employer_id)
        users = users_q.order_by(User.department_id.asc().nullslast(),
                                 User.employer_id.asc().nullslast(),
                                 User.last_name.asc(),
                                 User.first_name.asc()).all()

        modules = (Module.query
                   .filter_by(is_published=True)
                   .order_by(Module.title.asc()).all())

        # Latest passing attempt per (user, module) — single query.
        last_pass_rows = (db.session.query(
            Attempt.user_id, Attempt.module_id,
            func.max(Attempt.created_at).label("ts"))
            .filter(Attempt.passed.is_(True))
            .group_by(Attempt.user_id, Attempt.module_id).all())
        last_pass = {(r.user_id, r.module_id): r.ts for r in last_pass_rows}

        # Assignment lookup: (user_id, module_id) -> True
        assign_rows = (db.session.query(Assignment.user_id,
                                        Assignment.module_id).all())
        assigned = {(r.user_id, r.module_id) for r in assign_rows}

        now = datetime.utcnow()
        modules_by_id = {m.id: m for m in modules}
        matrix = {}
        for u in users:
            for m in modules:
                ts = last_pass.get((u.id, m.id))
                is_assigned = (u.id, m.id) in assigned
                if ts is None and not is_assigned:
                    status = "not_assigned"
                else:
                    status = compliance_status_for(ts, m, now)
                expires = module_expiry_for(ts, m) if ts else None
                matrix[(u.id, m.id)] = {
                    "status": status,
                    "last_pass": ts,
                    "expires": expires,
                }

        if fmt == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["User", "Department", "Employer"]
                       + [m.title for m in modules])
            for u in users:
                row = [u.name,
                       u.department.name if u.department else "",
                       u.employer.name if u.employer else ""]
                for m in modules:
                    cell = matrix[(u.id, m.id)]
                    if cell["status"] == "not_assigned":
                        row.append("")
                    elif cell["status"] == "never_passed":
                        row.append("Not yet")
                    elif cell["expires"] is None:
                        row.append("Current")
                    else:
                        row.append(cell["expires"].strftime("%Y-%m-%d"))
                w.writerow(row)
            csv_text = buf.getvalue()
            resp = Response(csv_text, mimetype="text/csv")
            stamp = now.strftime("%Y%m%d-%H%M")
            resp.headers["Content-Disposition"] = (
                f'attachment; filename="training-matrix-{stamp}.csv"')
            return resp

        departments = Department.query.order_by(Department.name).all()
        employers = Employer.query.order_by(Employer.name).all()
        return render_template("admin/training_matrix.html",
                               users=users, modules=modules,
                               matrix=matrix, departments=departments,
                               employers=employers,
                               filter_dept_id=dept_id,
                               filter_employer_id=employer_id)

    # universal navbar search — jump to a user or module by name
    @app.route("/admin/search")
    @author_required
    def admin_search():
        q = (request.args.get("q") or "").strip()
        if len(q) < 2:
            return jsonify(users=[], modules=[])

        like = f"%{q}%"
        results = {"users": [], "modules": []}

        modules = (
            Module.query
            .filter(Module.title.ilike(like))
            .order_by(Module.title.asc())
            .limit(8)
            .all()
        )
        results["modules"] = [
            {"id": m.id, "title": m.title,
             "url": url_for("admin_module_ai_studio", module_id=m.id)}
            for m in modules
        ]

        if current_user.is_admin:
            users = (
                User.query
                .filter(User.is_active_flag == True)
                .filter(or_(
                    User.name.ilike(like),
                    User.first_name.ilike(like),
                    User.last_name.ilike(like),
                    User.email.ilike(like),
                ))
                .order_by(User.name.asc())
                .limit(8)
                .all()
            )
            results["users"] = [
                {"id": u.id, "name": u.name, "email": u.email,
                 "url": url_for("admin_employee_detail", uid=u.id)}
                for u in users
            ]

        return jsonify(**results)

    # modules
    @app.route("/admin/modules")
    @author_required
    def admin_modules():
        modules = Module.query.order_by(Module.created_at.desc()).all()
        return render_template("admin/modules.html", modules=modules)

    @app.route("/admin/modules/rename", methods=["GET", "POST"])
    @author_required
    def admin_modules_rename():
        """Bulk title editor — useful for the SQF-aligned rename pass."""
        modules = Module.query.order_by(Module.title.asc()).all()
        if request.method == "POST":
            changed = 0
            errors = 0
            for m in modules:
                key = f"title_{m.id}"
                if key not in request.form:
                    continue
                new_title = request.form[key].strip()
                if not new_title:
                    errors += 1
                    continue
                if new_title != m.title:
                    log_audit("update", "module", m.id,
                              f"Renamed module from '{m.title}' to '{new_title}'")
                    m.title = new_title
                    changed += 1
            if changed:
                db.session.commit()
                flash(f"Renamed {changed} module(s).", "success")
            elif errors:
                flash("Some titles were blank — skipped those rows.", "warning")
            else:
                flash("No changes.", "info")
            return redirect(url_for("admin_modules_rename"))
        return render_template("admin/modules_rename.html", modules=modules)

    @app.route("/admin/modules/import", methods=["GET", "POST"])
    @author_required
    def admin_module_import():
        if request.method == "POST":
            raw = request.form.get("payload", "").strip()
            if not raw:
                flash("Paste the module JSON into the box.", "danger")
                return redirect(url_for("admin_module_import"))
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                flash(f"Invalid JSON: {e.msg} (line {e.lineno}, col {e.colno})", "danger")
                return render_template("admin/module_import.html", payload=raw)
            try:
                created = import_module_from_json(data, current_user.id)
                for _m in created:
                    log_audit("create", "module", _m.id,
                              f"Imported module '{_m.title}' from JSON")
                db.session.commit()
            except ValueError as e:
                db.session.rollback()
                flash(str(e), "danger")
                return render_template("admin/module_import.html", payload=raw)
            except Exception as e:
                db.session.rollback()
                app.logger.exception("Module import failed")
                flash(f"Import failed: {e}", "danger")
                return render_template("admin/module_import.html", payload=raw)

            if len(created) == 1:
                flash(f"Imported '{created[0].title}'.", "success")
                return redirect(url_for("admin_module_ai_studio",
                                        module_id=created[0].id))
            flash(f"Imported {len(created)} module(s).", "success")
            return redirect(url_for("admin_modules"))
        return render_template("admin/module_import.html", payload="")

    # Legacy route — any bookmark lands on the new studio
    @app.route("/admin/modules/ai-generate")
    @author_required
    def admin_module_ai_generate():
        return redirect(url_for("admin_module_ai_studio"))

    @app.route("/admin/modules/ai-studio", methods=["GET"])
    @author_required
    def admin_module_ai_studio():
        reap_old_files(current_user.id)
        studio = session.get("ai_studio") or {}
        try:
            provider = current_provider()
        except RuntimeError:
            provider = None
        provider_label = {"claude": "Claude", "gemini": "Gemini"}.get(provider, "AI")

        module_id = request.args.get("module_id", type=int)
        edit_module = db.session.get(Module, module_id) if module_id else None
        if edit_module and not current_user.can_author:
            edit_module = None
        # focus=edit: full-width edit pane, no chat. Used when editing a saved
        # module from the modules list. Ignored when there's no module to edit.
        hide_chat = bool(edit_module) and request.args.get("focus") == "edit"

        return render_template(
            "admin/module_ai_studio.html",
            history=studio.get("history") or [],
            files=studio.get("files") or {},
            current_json=studio.get("current_json", ""),
            provider=provider,
            provider_label=provider_label,
            edit_module=edit_module,
            hide_chat=hide_chat,
            rich_kinds=list(RICH_KINDS),
        )

    @app.route("/admin/modules/ai-studio/upload", methods=["POST"])
    @author_required
    def admin_module_ai_studio_upload():
        fs = request.files.get("file")
        if not fs or not fs.filename:
            return jsonify(error="No file uploaded."), 400
        try:
            meta = prepare_file(fs, current_user.id, current_provider())
        except ValueError as e:
            return jsonify(error=str(e)), 400
        except RuntimeError as e:
            return jsonify(error=str(e)), 400
        except Exception as e:
            app.logger.exception("File prep failed")
            return jsonify(error=f"Couldn't stage the file: {e}"), 500

        studio = session.get("ai_studio") or {"history": [], "files": {}, "current_json": ""}
        studio.setdefault("files", {})[meta["id"]] = meta
        session["ai_studio"] = studio
        session.modified = True

        return jsonify(
            file_id=meta["id"],
            filename=meta["filename"],
            mime_type=meta["mime_type"],
            kind=meta["kind"],
            size=meta["size"],
        )

    @app.route("/admin/modules/ai-studio/message", methods=["POST"])
    @author_required
    def admin_module_ai_studio_message():
        payload = request.get_json(silent=True) or {}
        text = (payload.get("message") or "").strip()
        file_ids = payload.get("file_ids") or []
        if not text and not file_ids:
            return jsonify(error="Type a message or attach a file."), 400
        try:
            reply, module_json = chat_turn(text, file_ids)
        except ValueError as e:
            return jsonify(error=str(e)), 400
        except RuntimeError as e:
            app.logger.warning("Gemini chat failed: %s", e)
            return jsonify(error=str(e)), 502
        except Exception as e:
            app.logger.exception("Gemini chat crashed")
            return jsonify(error=f"Unexpected error: {e}"), 500
        return jsonify(reply=reply or "", module_json=module_json or "")

    @app.route("/admin/modules/ai-studio/reset", methods=["POST"])
    @author_required
    def admin_module_ai_studio_reset():
        cleanup_local_files(session.get("ai_studio"))
        session.pop("ai_studio", None)
        return jsonify(ok=True)

    @app.route("/admin/modules/<int:mid>/apply-ai-update", methods=["POST"])
    @author_required
    def admin_module_apply_ai_update(mid):
        """Apply the latest AI-generated module spec (from chat session) to an
        existing module: positional-merge sections (preserving media), rebuild
        the quiz."""
        module = db.session.get(Module, mid) or abort(404)
        studio = session.get("ai_studio") or {}
        raw = (studio.get("current_json") or "").strip()
        if not raw:
            return jsonify(error="No AI module update available. Ask the AI to refine the module first."), 400
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            return jsonify(error=f"AI output could not be parsed: {e.msg}"), 400
        if isinstance(data, list):
            data = data[0] if data else None
        try:
            apply_module_json_to_existing(module, data)
            log_audit("update", "module", module.id,
                      f"AI-applied update to '{module.title}'")
            db.session.commit()
        except ValueError as e:
            db.session.rollback()
            return jsonify(error=str(e)), 400
        except Exception as e:
            db.session.rollback()
            app.logger.exception("Apply AI update failed")
            return jsonify(error=f"Apply failed: {e}"), 500
        return jsonify(ok=True)

    # -------- inline module / content-item editing (used by AI studio edit pane) --------

    MODULE_EDITABLE_FIELDS = {"title", "description", "is_published",
                              "valid_for_days"}
    CONTENT_EDITABLE_FIELDS = {"title", "body"}

    @app.route("/admin/modules/<int:mid>/update", methods=["POST"])
    @author_required
    def admin_module_inline_update(mid):
        m = db.session.get(Module, mid) or abort(404)
        data = request.get_json(silent=True) or {}
        field = (data.get("field") or "").strip()
        value = data.get("value", "")
        if field not in MODULE_EDITABLE_FIELDS:
            return jsonify(error="Unsupported field."), 400
        if field == "title":
            v = (value or "").strip()
            if not v:
                return jsonify(error="Title cannot be empty."), 400
            m.title = v
        elif field == "is_published":
            m.is_published = bool(value)
        elif field == "valid_for_days":
            raw = (str(value) if value is not None else "").strip()
            if raw == "":
                m.valid_for_days = None
            else:
                try:
                    n = int(raw)
                    if n < 0:
                        raise ValueError
                except ValueError:
                    return jsonify(error="Validity must be a non-negative whole number, "
                                         "or blank for the system default."), 400
                m.valid_for_days = n
        else:
            m.description = value or ""
        log_audit("update", "module", m.id,
                  f"Updated module '{m.title}' ({field})")
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/modules/<int:mid>/cover", methods=["POST"])
    @author_required
    def admin_module_cover_upload(mid):
        m = db.session.get(Module, mid) or abort(404)
        fs = request.files.get("file")
        if not fs or not fs.filename:
            return jsonify(error="No file uploaded."), 400
        try:
            stored = save_upload(fs, prefix="cover_")
        except ValueError as e:
            return jsonify(error=str(e)), 400
        m.cover_path = stored
        db.session.commit()
        return jsonify(ok=True,
                       path=stored,
                       url=url_for("uploaded_file", name=stored),
                       kind=media_kind_for(stored))

    @app.route("/admin/modules/<int:mid>/cover/clear", methods=["POST"])
    @author_required
    def admin_module_cover_clear(mid):
        m = db.session.get(Module, mid) or abort(404)
        m.cover_path = ""
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/modules/<int:mid>/media/add", methods=["POST"])
    @author_required
    def admin_module_media_add(mid):
        """Append one image/video to a module's title-area gallery."""
        m = db.session.get(Module, mid) or abort(404)
        fs = request.files.get("file")
        if not fs or not fs.filename:
            return jsonify(error="No file uploaded."), 400
        try:
            stored = save_upload(fs, prefix="mod_")
        except ValueError as e:
            return jsonify(error=str(e)), 400
        kind = media_kind_for(stored)
        if kind not in ("image", "video"):
            return jsonify(error="Only image or video files are allowed."), 400
        next_pos = (db.session.query(db.func.coalesce(db.func.max(ModuleMedia.position), -1))
                    .filter(ModuleMedia.module_id == m.id).scalar()) + 1
        mm = ModuleMedia(module_id=m.id, file_path=stored,
                         kind=kind, position=next_pos)
        db.session.add(mm)
        db.session.commit()
        return jsonify(ok=True,
                       id=mm.id,
                       path=stored,
                       url=url_for("uploaded_file", name=stored),
                       kind=kind,
                       position=mm.position)

    @app.route("/admin/modules/<int:mid>/media/<int:media_id>/remove",
               methods=["POST"])
    @author_required
    def admin_module_media_remove(mid, media_id):
        m = db.session.get(Module, mid) or abort(404)
        mm = db.session.get(ModuleMedia, media_id) or abort(404)
        if mm.module_id != m.id:
            abort(404)
        db.session.delete(mm)
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/modules/<int:mid>/content/<int:cid>/update",
               methods=["POST"])
    @author_required
    def admin_content_inline_update(mid, cid):
        ci = db.session.get(ContentItem, cid) or abort(404)
        if ci.module_id != mid:
            abort(404)
        data = request.get_json(silent=True) or {}
        field = (data.get("field") or "").strip()
        value = data.get("value", "")
        if field not in CONTENT_EDITABLE_FIELDS:
            return jsonify(error="Unsupported field."), 400
        if field == "title":
            v = (value or "").strip()
            if not v:
                return jsonify(error="Title cannot be empty."), 400
            ci.title = v
        else:
            ci.body = value or ""
        log_audit("update", "content", ci.id,
                  f"Updated section '{ci.title}' in module #{ci.module_id} ({field})")
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/modules/<int:mid>/content/<int:cid>/media",
               methods=["POST"])
    @author_required
    def admin_content_media_upload(mid, cid):
        ci = db.session.get(ContentItem, cid) or abort(404)
        if ci.module_id != mid:
            abort(404)
        if ci.kind not in RICH_KINDS:
            return jsonify(error="Media can only be attached to AI-generated sections."), 400
        fs = request.files.get("file")
        if not fs or not fs.filename:
            return jsonify(error="No file uploaded."), 400
        try:
            stored = save_upload(fs, prefix="sec_")
        except ValueError as e:
            return jsonify(error=str(e)), 400
        kind = media_kind_for(stored)
        if kind not in ("image", "video"):
            return jsonify(error="Only image or video files are allowed on sections."), 400
        ci.file_path = stored
        db.session.commit()
        return jsonify(ok=True,
                       path=stored,
                       url=url_for("uploaded_file", name=stored),
                       kind=kind)

    @app.route("/admin/modules/<int:mid>/content/<int:cid>/media/clear",
               methods=["POST"])
    @author_required
    def admin_content_media_clear(mid, cid):
        ci = db.session.get(ContentItem, cid) or abort(404)
        if ci.module_id != mid:
            abort(404)
        if ci.kind not in RICH_KINDS:
            return jsonify(error="Not allowed."), 400
        ci.file_path = ""
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/modules/<int:mid>/content/<int:cid>/media/add",
               methods=["POST"])
    @author_required
    def admin_content_media_add(mid, cid):
        """Append one image/video to a section's media_items list."""
        ci = db.session.get(ContentItem, cid) or abort(404)
        if ci.module_id != mid:
            abort(404)
        if ci.kind not in RICH_KINDS:
            return jsonify(error="Media can only be attached to AI-generated sections."), 400
        fs = request.files.get("file")
        if not fs or not fs.filename:
            return jsonify(error="No file uploaded."), 400
        try:
            stored = save_upload(fs, prefix="sec_")
        except ValueError as e:
            return jsonify(error=str(e)), 400
        kind = media_kind_for(stored)
        if kind not in ("image", "video"):
            return jsonify(error="Only image or video files are allowed on sections."), 400
        next_pos = (db.session.query(db.func.coalesce(db.func.max(ContentItemMedia.position), -1))
                    .filter(ContentItemMedia.content_item_id == ci.id).scalar()) + 1
        m = ContentItemMedia(content_item_id=ci.id, file_path=stored,
                             kind=kind, position=next_pos)
        db.session.add(m)
        db.session.commit()
        return jsonify(ok=True,
                       id=m.id,
                       path=stored,
                       url=url_for("uploaded_file", name=stored),
                       kind=kind,
                       position=m.position)

    @app.route("/admin/modules/<int:mid>/content/<int:cid>/media/<int:media_id>/remove",
               methods=["POST"])
    @author_required
    def admin_content_media_remove(mid, cid, media_id):
        ci = db.session.get(ContentItem, cid) or abort(404)
        if ci.module_id != mid:
            abort(404)
        m = db.session.get(ContentItemMedia, media_id) or abort(404)
        if m.content_item_id != ci.id:
            abort(404)
        db.session.delete(m)
        db.session.commit()
        return jsonify(ok=True)

    def _parse_valid_for_days(raw):
        """Returns (value_or_None, error_msg). Empty = None (use global default),
        '0' = 0 (never expires), positive int = N days. Negative or non-numeric
        returns an error message."""
        s = (raw or "").strip()
        if s == "":
            return None, None
        try:
            n = int(s)
            if n < 0:
                raise ValueError
        except ValueError:
            return None, ("Validity period must be a non-negative whole number, "
                          "or blank for the system default.")
        return n, None

    @app.route("/admin/modules/new", methods=["GET", "POST"])
    @author_required
    def admin_module_new():
        if request.method == "POST":
            vfd, err = _parse_valid_for_days(request.form.get("valid_for_days"))
            if err:
                flash(err, "danger")
                return redirect(request.url)
            m = Module(title=request.form["title"].strip(),
                       description=request.form.get("description", ""),
                       created_by_id=current_user.id,
                       valid_for_days=vfd)
            db.session.add(m)
            db.session.flush()
            log_audit("create", "module", m.id,
                      f"Created module '{m.title}'")
            db.session.commit()
            flash("Module created.", "success")
            return redirect(url_for("admin_module_edit", module_id=m.id))
        return render_template("admin/module_form.html", module=None)

    @app.route("/admin/modules/<int:module_id>", methods=["GET", "POST"])
    @author_required
    def admin_module_edit(module_id):
        # Legacy form editor superseded by the AI studio side-by-side layout.
        # Keep the route so existing links keep working — redirect to studio.
        m = db.session.get(Module, module_id) or abort(404)
        if request.method == "POST":
            vfd, err = _parse_valid_for_days(request.form.get("valid_for_days"))
            if err:
                flash(err, "danger")
                return redirect(request.url)
            m.title = request.form["title"].strip()
            m.description = request.form.get("description", "")
            m.is_published = bool(request.form.get("is_published"))
            m.valid_for_days = vfd
            log_audit("update", "module", m.id,
                      f"Updated module '{m.title}'")
            db.session.commit()
            flash("Module saved.", "success")
        return redirect(url_for("admin_module_ai_studio", module_id=m.id))

    @app.route("/admin/modules/<int:module_id>/preview")
    @author_required
    def admin_module_preview(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        back = request.args.get("back") or "edit"  # "edit" | "ai_studio"
        return render_template("employee/module.html",
                               module=m, assignment=None,
                               preview=True, preview_back=back)

    @app.route("/admin/modules/<int:module_id>/preview/quiz",
               methods=["GET", "POST"])
    @author_required
    def admin_module_preview_quiz(module_id):
        """Take the quiz in preview mode. Attempts are NOT persisted."""
        m = db.session.get(Module, module_id) or abort(404)
        back = request.args.get("back") or "edit"
        if not m.questions:
            flash("This module has no quiz yet.", "info")
            return redirect(url_for("admin_module_preview",
                                    module_id=module_id, back=back))
        if request.method == "POST":
            answers = {}
            for q in m.questions:
                answers[str(q.id)] = request.form.getlist(f"q_{q.id}")
            correct, total, percent = score_attempt(m, answers)
            threshold = app.config.get("PASS_THRESHOLD", 80)
            from types import SimpleNamespace
            attempt = SimpleNamespace(
                score=percent, correct=correct, total=total,
                passed=percent >= threshold,
            )
            return render_template("employee/result.html",
                                   attempt=attempt, module=m,
                                   threshold=threshold,
                                   preview=True, preview_back=back,
                                   review=attempt_review(m, answers))
        return render_template("employee/quiz.html",
                               module=m, preview=True, preview_back=back)

    @app.route("/admin/modules/<int:module_id>/self-assign", methods=["POST"])
    @author_required
    def admin_module_self_assign(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        a = Assignment.query.filter_by(user_id=current_user.id,
                                       module_id=module_id).first()
        if not a:
            latest = (ModuleVersion.query.filter_by(module_id=module_id)
                      .order_by(ModuleVersion.version_number.desc()).first())
            a = Assignment(user_id=current_user.id, module_id=module_id,
                           version_id=latest.id if latest else None)
            db.session.add(a)
            db.session.commit()
            flash(f"'{m.title}' assigned to you.", "success")
        else:
            flash("You already have this module assigned.", "info")
        return redirect(url_for("my_module", module_id=module_id))

    @app.route("/admin/modules/<int:module_id>/versions/save", methods=["POST"])
    @author_required
    def admin_module_version_save(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        summary = ((request.get_json(silent=True) or {}).get("summary", "") or "")[:255]
        next_n = (db.session.query(db.func.max(ModuleVersion.version_number))
                  .filter_by(module_id=module_id).scalar() or 0) + 1
        v = ModuleVersion(module_id=module_id, version_number=next_n,
                          snapshot_json=json.dumps(build_module_snapshot(m)),
                          created_by_id=current_user.id, summary=summary)
        db.session.add(v)
        db.session.flush()
        log_audit("version_save", "module", m.id,
                  f"Saved v{v.version_number} of '{m.title}'")
        db.session.commit()
        return jsonify({"ok": True, "version_id": v.id,
                        "version_number": v.version_number,
                        "created_at": v.created_at.isoformat()})

    @app.route("/admin/modules/<int:module_id>/assignments-json")
    @author_required
    def admin_module_assignments_json(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        latest_v = (ModuleVersion.query.filter_by(module_id=module_id)
                    .order_by(ModuleVersion.version_number.desc()).first())
        role_order = db.case(
            (User.role == "employee", 0),
            (User.role == "qaqc", 1),
            (User.role == "admin", 2),
            else_=3,
        )
        users = (User.query
                 .options(db.joinedload(User.department))
                 .filter(User.is_active_flag == True,
                         User.role.in_(("employee", "qaqc", "admin")))
                 .order_by(role_order, User.name).all())
        assigns = {a.user_id: a for a in
                   Assignment.query.filter_by(module_id=module_id).all()}
        rows = []
        for u in users:
            a = assigns.get(u.id)
            if a is None:
                status = "unassigned"
            elif a.completed_at is not None:
                status = "completed"
            else:
                status = "assigned"
            v = a.version if a else None
            if a is None:
                is_latest = False
            elif v is None:
                # Assigned without a pinned version (legacy or no versions saved).
                # Treat as "latest" only if no versions exist for this module.
                is_latest = latest_v is None
            else:
                is_latest = (latest_v is not None and v.id == latest_v.id)
            rows.append({
                "user_id": u.id, "name": u.name, "email": u.email,
                "department": u.department.name if u.department else "",
                "status": status,
                "completed_at": a.completed_at.isoformat() if a and a.completed_at else None,
                "version_number": v.version_number if v else None,
                "is_latest": is_latest,
            })
        return jsonify({
            "module_id": m.id, "module_title": m.title,
            "latest_version_number": latest_v.version_number if latest_v else None,
            "users": rows,
        })

    @app.route("/admin/modules/<int:module_id>/assignments/toggle", methods=["POST"])
    @author_required
    def admin_module_assignment_toggle(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        data = request.get_json(silent=True) or {}
        try:
            uid = int(data.get("user_id") or 0)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid user_id"}), 400
        assign = bool(data.get("assign"))
        u = db.session.get(User, uid) or abort(404)
        a = Assignment.query.filter_by(user_id=uid, module_id=module_id).first()
        if assign:
            if a is None:
                latest = (ModuleVersion.query.filter_by(module_id=module_id)
                          .order_by(ModuleVersion.version_number.desc()).first())
                now = datetime.utcnow()
                a = Assignment(user_id=uid, module_id=module_id,
                               assigned_at=now, due_at=assignment_due_from(now),
                               version_id=latest.id if latest else None)
                db.session.add(a)
                db.session.flush()
                log_audit("create", "assignment", a.id,
                          f"Assigned '{m.title}' to {u.email}")
                db.session.commit()
                try:
                    notify_assignment(u, m, app.config["APP_BASE_URL"])
                except Exception:
                    pass
            status = "completed" if a.completed_at else "assigned"
            v = a.version
            return jsonify({"ok": True, "status": status,
                            "version_number": v.version_number if v else None,
                            "is_latest": True})
        else:
            if a is not None:
                log_audit("delete", "assignment", a.id,
                          f"Unassigned '{m.title}' from {u.email}")
                db.session.delete(a)
                db.session.commit()
            return jsonify({"ok": True, "status": "unassigned",
                            "version_number": None, "is_latest": False})

    @app.route("/admin/modules/<int:module_id>/assignments/push-latest",
               methods=["POST"])
    @author_required
    def admin_module_assignment_push_latest(module_id):
        try:
            uid = int((request.get_json(silent=True) or {}).get("user_id") or 0)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid user_id"}), 400
        a = (Assignment.query.filter_by(user_id=uid, module_id=module_id).first()
             or abort(404))
        latest = (ModuleVersion.query.filter_by(module_id=module_id)
                  .order_by(ModuleVersion.version_number.desc()).first())
        if latest is not None:
            a.version_id = latest.id
            log_audit("update", "assignment", a.id,
                      f"Pushed v{latest.version_number} to assignment #{a.id}")
            db.session.commit()
        return jsonify({"ok": True,
                        "version_number": latest.version_number if latest else None,
                        "is_latest": True})

    @app.route("/admin/modules/<int:module_id>/delete", methods=["POST"])
    @author_required
    def admin_module_delete(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        log_audit("delete", "module", module_id,
                  f"Deleted module #{module_id} '{m.title}'")
        db.session.delete(m)
        db.session.commit()
        flash("Module deleted.", "success")
        return redirect(url_for("admin_modules"))

    # content items
    @app.route("/admin/modules/<int:module_id>/content/add", methods=["POST"])
    @author_required
    def admin_content_add(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        kind = request.form.get("kind", "text")
        title = request.form.get("title", "Untitled").strip()
        body = request.form.get("body", "")
        file_path = ""

        f = request.files.get("file")
        if f and f.filename:
            if not allowed_file(f.filename):
                flash("File type not allowed.", "danger")
                return redirect(url_for("admin_module_edit", module_id=m.id))
            safe = secure_filename(f.filename)
            stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
            final = f"{stamp}_{safe}"
            f.save(os.path.join(app.config["UPLOAD_FOLDER"], final))
            file_path = final

        ci = ContentItem(module_id=m.id, kind=kind, title=title,
                         body=body, file_path=file_path,
                         position=len(m.content_items))
        db.session.add(ci)
        db.session.flush()
        log_audit("create", "content", ci.id,
                  f"Added '{ci.title}' ({ci.kind}) to module '{m.title}'")
        db.session.commit()
        flash("Content added.", "success")
        return redirect(url_for("admin_module_edit", module_id=m.id))

    @app.route("/admin/content/<int:item_id>/delete", methods=["POST"])
    @author_required
    def admin_content_delete(item_id):
        ci = db.session.get(ContentItem, item_id) or abort(404)
        mid = ci.module_id
        log_audit("delete", "content", ci.id,
                  f"Deleted section '{ci.title}' from module #{mid}")
        db.session.delete(ci)
        db.session.commit()
        return redirect(url_for("admin_module_edit", module_id=mid))

    # questions
    @app.route("/admin/modules/<int:module_id>/questions/add", methods=["POST"])
    @author_required
    def admin_question_add(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        prompt = request.form.get("prompt", "").strip()
        kind = request.form.get("kind", "single")
        if not prompt:
            flash("Question text required.", "danger")
            return redirect(url_for("admin_module_edit", module_id=m.id))

        q = Question(module_id=m.id, prompt=prompt, kind=kind,
                     position=len(m.questions))
        db.session.add(q)
        db.session.flush()

        texts = request.form.getlist("choice_text")
        correct_flags = request.form.getlist("correct")
        correct_set = set(correct_flags)
        for idx, text in enumerate(texts):
            t = text.strip()
            if not t:
                continue
            c = Choice(question_id=q.id, text=t,
                       is_correct=str(idx) in correct_set,
                       position=idx)
            db.session.add(c)
        log_audit("create", "question", q.id,
                  f"Added question to module #{m.id}: {q.prompt[:80]}")
        db.session.commit()
        flash("Question added.", "success")
        return redirect(url_for("admin_module_edit", module_id=m.id))

    @app.route("/admin/questions/<int:q_id>/delete", methods=["POST"])
    @author_required
    def admin_question_delete(q_id):
        q = db.session.get(Question, q_id) or abort(404)
        mid = q.module_id
        log_audit("delete", "question", q.id,
                  f"Deleted question from module #{mid}: {q.prompt[:80]}")
        db.session.delete(q)
        db.session.commit()
        return redirect(url_for("admin_module_edit", module_id=mid))

    # ---- AJAX quiz editing (used by the AI studio edit pane) ----

    @app.route("/admin/modules/<int:mid>/questions/add-quick", methods=["POST"])
    @author_required
    def admin_question_add_quick(mid):
        m = db.session.get(Module, mid) or abort(404)
        q = Question(module_id=m.id, prompt="New question",
                     kind="single", position=len(m.questions))
        db.session.add(q)
        db.session.flush()
        c1 = Choice(question_id=q.id, text="Option A",
                    is_correct=True, position=0)
        c2 = Choice(question_id=q.id, text="Option B",
                    is_correct=False, position=1)
        db.session.add_all([c1, c2])
        log_audit("create", "question", q.id,
                  f"Quick-added question to module #{m.id}")
        db.session.commit()
        return jsonify(ok=True, question_id=q.id,
                       choices=[{"id": c1.id, "text": c1.text, "is_correct": True, "position": 0},
                                {"id": c2.id, "text": c2.text, "is_correct": False, "position": 1}])

    @app.route("/admin/questions/<int:qid>/update", methods=["POST"])
    @author_required
    def admin_question_update(qid):
        q = db.session.get(Question, qid) or abort(404)
        data = request.get_json(silent=True) or {}
        field = (data.get("field") or "").strip()
        value = data.get("value", "")
        if field == "prompt":
            v = (value or "").strip()
            if not v:
                return jsonify(error="Question text cannot be empty."), 400
            q.prompt = v
        elif field == "kind":
            if value not in ("single", "multi"):
                return jsonify(error="Unsupported question kind."), 400
            q.kind = value
        else:
            return jsonify(error="Unsupported field."), 400
        log_audit("update", "question", q.id,
                  f"Updated question in module #{q.module_id} ({field})")
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/questions/<int:qid>/delete-ajax", methods=["POST"])
    @author_required
    def admin_question_delete_ajax(qid):
        q = db.session.get(Question, qid) or abort(404)
        log_audit("delete", "question", q.id,
                  f"Deleted question from module #{q.module_id}: {q.prompt[:80]}")
        db.session.delete(q)
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/questions/<int:qid>/choices/add", methods=["POST"])
    @author_required
    def admin_choice_add(qid):
        q = db.session.get(Question, qid) or abort(404)
        c = Choice(question_id=q.id, text="New option",
                   is_correct=False, position=len(q.choices))
        db.session.add(c)
        db.session.flush()
        log_audit("create", "choice", c.id,
                  f"Added choice to question #{q.id}")
        db.session.commit()
        return jsonify(ok=True, id=c.id, text=c.text,
                       is_correct=False, position=c.position)

    @app.route("/admin/choices/<int:cid>/update", methods=["POST"])
    @author_required
    def admin_choice_update(cid):
        c = db.session.get(Choice, cid) or abort(404)
        data = request.get_json(silent=True) or {}
        field = (data.get("field") or "").strip()
        value = data.get("value", "")
        if field == "text":
            v = (value or "").strip()
            if not v:
                return jsonify(error="Choice text cannot be empty."), 400
            c.text = v
        elif field == "is_correct":
            c.is_correct = bool(value)
            # If single-answer mode, clear other choices' correct flags.
            if c.is_correct and c.question.kind == "single":
                for other in c.question.choices:
                    if other.id != c.id:
                        other.is_correct = False
        else:
            return jsonify(error="Unsupported field."), 400
        log_audit("update", "choice", c.id,
                  f"Updated choice in question #{c.question_id} ({field})")
        db.session.commit()
        return jsonify(ok=True)

    @app.route("/admin/choices/<int:cid>/delete", methods=["POST"])
    @author_required
    def admin_choice_delete(cid):
        c = db.session.get(Choice, cid) or abort(404)
        if len(c.question.choices) <= 2:
            return jsonify(error="A question needs at least two choices."), 400
        log_audit("delete", "choice", c.id,
                  f"Deleted choice from question #{c.question_id}")
        db.session.delete(c)
        db.session.commit()
        return jsonify(ok=True)

    # audit logs (admin-only)
    @app.route("/admin/audit-logs")
    @admin_required
    def admin_audit_logs():
        try:
            page = max(int(request.args.get("page", 1) or 1), 1)
        except (TypeError, ValueError):
            page = 1
        per_page = 50
        q = AuditLog.query
        actor_id = request.args.get("actor_id", type=int)
        if actor_id:
            q = q.filter(AuditLog.user_id == actor_id)
        et = (request.args.get("entity_type") or "").strip()
        if et:
            q = q.filter(AuditLog.entity_type == et)
        act = (request.args.get("action") or "").strip()
        if act:
            q = q.filter(AuditLog.action == act)
        df = (request.args.get("date_from") or "").strip()
        dt_ = (request.args.get("date_to") or "").strip()
        if df:
            try:
                q = q.filter(AuditLog.created_at
                             >= datetime.strptime(df, "%Y-%m-%d"))
            except ValueError:
                df = ""
        if dt_:
            try:
                q = q.filter(AuditLog.created_at
                             < datetime.strptime(dt_, "%Y-%m-%d")
                             + timedelta(days=1))
            except ValueError:
                dt_ = ""
        total = q.count()
        rows = (q.order_by(AuditLog.created_at.desc())
                  .offset((page - 1) * per_page)
                  .limit(per_page)
                  .all())
        pages = max((total + per_page - 1) // per_page, 1)
        users = User.query.order_by(User.name).all()
        entity_types = ["user", "module", "content", "question", "choice",
                        "assignment", "department", "machine"]
        actions = ["create", "update", "delete", "role_change",
                   "toggle_active", "password_reset", "version_save"]
        return render_template(
            "admin/audit_logs.html",
            rows=rows, page=page, pages=pages, total=total,
            users=users, entity_types=entity_types, actions=actions,
            f={"actor_id": actor_id or "",
               "entity_type": et,
               "action": act,
               "date_from": df,
               "date_to": dt_},
        )

    @app.route("/admin/audit-logs/prune", methods=["POST"])
    @admin_required
    def admin_audit_logs_prune():
        try:
            days = max(int(request.form.get("days", 365) or 365), 1)
        except (TypeError, ValueError):
            days = 365
        cutoff = datetime.utcnow() - timedelta(days=days)
        n = (AuditLog.query
             .filter(AuditLog.created_at < cutoff)
             .delete(synchronize_session=False))
        db.session.commit()
        flash(f"Pruned {n} audit log row(s) older than {days} days.",
              "success")
        return redirect(url_for("admin_audit_logs"))

    # users (employees + admins)
    @app.route("/admin/employees")
    @author_required
    def admin_employees():
        employees = (User.query
                     .options(db.joinedload(User.department),
                              db.joinedload(User.employer),
                              db.selectinload(User.machines))
                     .order_by(User.role.desc(), User.name)
                     .all())
        departments = Department.query.order_by(Department.name).all()
        employers = Employer.query.order_by(Employer.name).all()
        positions = Position.query.order_by(Position.name).all()
        active_count = sum(1 for e in employees if e.is_active_flag)
        disabled_count = len(employees) - active_count
        return render_template("admin/employees.html",
                               employees=employees, departments=departments,
                               employers=employers, positions=positions,
                               total_count=len(employees),
                               active_count=active_count,
                               disabled_count=disabled_count)

    @app.route("/admin/employees/new", methods=["POST"])
    @author_required
    def admin_employee_new():
        first_name = request.form.get("first_name", "").strip()
        last_name = request.form.get("last_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        phone = request.form.get("phone", "").strip()
        dept_raw = request.form.get("department_id", "").strip()
        employer_name = request.form.get("employer_name", "").strip()
        role = request.form.get("role", "employee")
        if role not in VALID_ROLES:
            role = "employee"
        if role == "admin" and not current_user.is_admin:
            flash("Only administrators can create admin accounts — set to QA/QC instead.", "warning")
            role = "qaqc"

        try:
            start_date = parse_user_date(request.form.get("start_date", ""))
            termination_date = parse_user_date(
                request.form.get("termination_date", ""))
        except ValueError as exc:
            flash(f"Date format wrong: {exc}. Use YYYY-MM-DD.", "danger")
            return redirect(url_for("admin_employees"))

        missing = []
        if not first_name: missing.append("First name")
        if not last_name:  missing.append("Last name")
        if not email or "@" not in email: missing.append("Email")
        if not phone:      missing.append("Phone")
        if not dept_raw.isdigit(): missing.append("Department")
        if not employer_name: missing.append("Employer")
        if missing:
            flash("Missing required field(s): " + ", ".join(missing), "danger")
            return redirect(url_for("admin_employees"))

        if User.query.filter_by(email=email).first():
            flash("A user with this email already exists.", "danger")
            return redirect(url_for("admin_employees"))

        employer = get_or_create_employer(employer_name)
        full_name = f"{first_name} {last_name}".strip()
        temp_pw = secrets.token_urlsafe(9)
        job_title = request.form.get("job_title", "").strip()
        pos_raw = request.form.get("position_id", "").strip()
        position_id = int(pos_raw) if pos_raw.isdigit() else None
        if position_id is not None and db.session.get(Position, position_id) is None:
            position_id = None
        u = User(name=full_name, first_name=first_name, last_name=last_name,
                 email=email, phone=phone, role=role,
                 department_id=int(dept_raw),
                 employer_id=employer.id if employer else None,
                 start_date=start_date,
                 termination_date=termination_date,
                 job_title=job_title,
                 position_id=position_id)
        u.set_password(temp_pw)
        db.session.add(u)
        db.session.flush()
        log_audit("create", "user", u.id,
                  f"Created user {u.email} ({u.role})")
        db.session.commit()
        notify_invite(u, temp_pw, app.config["APP_BASE_URL"])
        auto_count = auto_assign_for_department(u, send_email=False)
        msg = f"{u.role_label} created. Temporary password: {temp_pw}"
        if auto_count:
            msg += (f" — {auto_count} module"
                    f"{'s' if auto_count != 1 else ''} auto-assigned "
                    f"from {u.department.name} policy.")
        flash(msg, "success")
        return redirect(url_for("admin_employees"))

    @app.route("/admin/employees/<int:uid>/toggle", methods=["POST"])
    @author_required
    def admin_employee_toggle(uid):
        u = db.session.get(User, uid) or abort(404)
        if u.id == current_user.id:
            flash("You cannot disable your own account.", "danger")
            return redirect(url_for("admin_employees"))
        if u.is_admin and not current_user.is_admin:
            abort(403)
        u.is_active_flag = not u.is_active_flag
        log_audit("toggle_active", "user", u.id,
                  f"{'Activated' if u.is_active_flag else 'Deactivated'} {u.email}")
        db.session.commit()
        return redirect(url_for("admin_employees"))

    @app.route("/admin/employees/<int:uid>/role", methods=["POST"])
    @admin_required
    def admin_employee_role(uid):
        u = db.session.get(User, uid) or abort(404)
        if u.id == current_user.id:
            flash("You cannot change your own role.", "danger")
            return redirect(url_for("admin_employees"))
        new_role = request.form.get("role", "")
        if new_role in VALID_ROLES:
            old_role = u.role
            u.role = new_role
            log_audit("role_change", "user", u.id,
                      f"Role of {u.email}: {old_role} -> {new_role}")
            db.session.commit()
            flash(f"{u.name} is now {u.role_label}.", "success")
        return redirect(url_for("admin_employees"))

    @app.route("/admin/employees/<int:uid>/reset-password", methods=["POST"])
    @author_required
    def admin_employee_reset_password(uid):
        u = db.session.get(User, uid) or abort(404)
        if u.is_admin and not current_user.is_admin:
            abort(403)
        temp_pw = secrets.token_urlsafe(9)
        u.set_password(temp_pw)
        log_audit("password_reset", "user", u.id,
                  f"Reset password for {u.email}")
        db.session.commit()
        emailed = False
        try:
            emailed = bool(notify_password_reset(u, temp_pw, app.config["APP_BASE_URL"]))
        except Exception:
            emailed = False
        msg = f"Password reset for {u.email}. Temporary password: {temp_pw}"
        if emailed:
            msg += " (emailed to the user)"
        else:
            msg += " (email not sent — share the password manually)"
        flash(msg, "success")
        return redirect(url_for("admin_employee_edit", uid=u.id))

    @app.route("/admin/employees/<int:uid>/edit", methods=["GET", "POST"])
    @author_required
    def admin_employee_edit(uid):
        u = db.session.get(User, uid) or abort(404)
        if u.is_admin and not current_user.is_admin:
            abort(403)
        if request.method == "POST":
            first_name = request.form.get("first_name", u.first_name or "").strip()
            last_name = request.form.get("last_name", u.last_name or "").strip()
            phone = request.form.get("phone", "").strip()
            dept_raw = request.form.get("department_id", "").strip()
            employer_name = request.form.get("employer_name", "").strip()

            try:
                start_date = parse_user_date(request.form.get("start_date", ""))
                termination_date = parse_user_date(
                    request.form.get("termination_date", ""))
            except ValueError as exc:
                flash(f"Date format wrong: {exc}. Use YYYY-MM-DD.", "danger")
                return redirect(url_for("admin_employee_edit", uid=u.id))

            missing = []
            if not first_name: missing.append("First name")
            if not last_name:  missing.append("Last name")
            if not phone:      missing.append("Phone")
            if not dept_raw.isdigit(): missing.append("Department")
            if not employer_name: missing.append("Employer")
            if missing:
                flash("Missing required field(s): " + ", ".join(missing), "danger")
                return redirect(url_for("admin_employee_edit", uid=u.id))

            old_department_id = u.department_id
            u.first_name = first_name
            u.last_name = last_name
            u.name = f"{first_name} {last_name}".strip()
            u.phone = phone
            u.department_id = int(dept_raw)
            u.employer_id = get_or_create_employer(employer_name).id
            u.start_date = start_date
            u.termination_date = termination_date
            u.job_title = request.form.get("job_title", "").strip()
            pos_raw = request.form.get("position_id", "").strip()
            new_position_id = int(pos_raw) if pos_raw.isdigit() else None
            if new_position_id is not None and db.session.get(Position, new_position_id) is None:
                new_position_id = None
            u.position_id = new_position_id

            machine_ids = [int(x) for x in request.form.getlist("machine_ids") if x.isdigit()]
            u.machines = Machine.query.filter(Machine.id.in_(machine_ids)).all() if machine_ids else []
            photo_fs = request.files.get("photo")
            if photo_fs and (photo_fs.filename or "").strip():
                try:
                    set_user_photo(u, photo_fs)
                except ValueError as exc:
                    db.session.rollback()
                    flash(f"Photo not saved: {exc}", "danger")
                    return redirect(url_for("admin_employee_edit", uid=u.id))
            elif request.form.get("remove_photo"):
                clear_user_photo(u)
            new_role = request.form.get("role", u.role)
            if new_role == "admin" and not current_user.is_admin:
                new_role = u.role
            if new_role in VALID_ROLES and u.id != current_user.id:
                u.role = new_role
            log_audit("update", "user", u.id,
                      f"Edited user {u.email}")
            db.session.commit()
            auto_count = 0
            if u.department_id != old_department_id:
                auto_count = auto_assign_for_department(
                    u, base_url=app.config.get("APP_BASE_URL", ""),
                    send_email=True)
            msg = f"{u.name} updated."
            if auto_count:
                msg += (f" Auto-assigned {auto_count} module"
                        f"{'s' if auto_count != 1 else ''} "
                        f"from new department '{u.department.name}'.")
            flash(msg, "success")
            return redirect(url_for("admin_employees"))
        departments = Department.query.order_by(Department.name).all()
        employers = Employer.query.order_by(Employer.name).all()
        machines = Machine.query.order_by(Machine.name).all()
        positions = Position.query.order_by(Position.name).all()
        return render_template("admin/employee_edit.html",
                               employee=u, departments=departments,
                               employers=employers, machines=machines,
                               positions=positions)

    @app.route("/admin/employees/<int:uid>")
    @author_required
    def admin_employee_detail(uid):
        u = db.session.get(User, uid) or abort(404)

        assignments = (Assignment.query
                       .filter_by(user_id=u.id)
                       .options(db.joinedload(Assignment.module))
                       .all())
        attempts = (Attempt.query
                    .filter_by(user_id=u.id)
                    .options(db.joinedload(Attempt.module))
                    .order_by(Attempt.created_at.desc())
                    .all())

        attempts_by_mod = {}
        for a in attempts:
            attempts_by_mod.setdefault(a.module_id, []).append(a)

        rows_by_mod = {}
        for asn in assignments:
            rows_by_mod[asn.module_id] = {
                "module": asn.module,
                "assigned": True,
                "assigned_at": asn.assigned_at,
                "due_at": asn.due_at,
                "completed_at": asn.completed_at,
                "attempts": attempts_by_mod.get(asn.module_id, []),
            }
        for mod_id, atts in attempts_by_mod.items():
            if mod_id not in rows_by_mod:
                rows_by_mod[mod_id] = {
                    "module": atts[0].module,
                    "assigned": False,
                    "assigned_at": None,
                    "due_at": None,
                    "completed_at": None,
                    "attempts": atts,
                }

        rows = []
        counts = {"passed": 0, "failed": 0, "not_attempted": 0,
                  "unassigned_attempt": 0}
        for r in rows_by_mod.values():
            atts = r["attempts"]
            if atts:
                r["best_score"] = max(a.score for a in atts)
                r["latest"] = atts[0]
                r["status"] = "passed" if any(a.passed for a in atts) else "failed"
            else:
                r["best_score"] = None
                r["latest"] = None
                r["status"] = "not_attempted" if r["assigned"] else "unassigned_attempt"
            counts[r["status"]] += 1
            rows.append(r)

        rows.sort(key=lambda r: (r["module"].title or "").lower())
        recent_attempts = attempts[:20]
        pass_threshold = app.config.get("PASS_THRESHOLD", 80)
        competencies = user_machine_competencies(u)
        return render_template("admin/employee_detail.html",
                               employee=u, rows=rows, counts=counts,
                               recent_attempts=recent_attempts,
                               pass_threshold=pass_threshold,
                               competencies=competencies)

    @app.route("/admin/employees/template.csv")
    @author_required
    def admin_employees_template():
        """Download a CSV template that opens cleanly in Excel."""
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["First Name", "Last Name", "Email", "Phone",
                    "Department", "Role", "Employer", "Machines",
                    "Start Date", "Termination Date",
                    "Job Title", "Position"])
        w.writerow(["Jane", "Doe", "jane.doe@example.com", "0400 000 000",
                    "Production", "employee", "German Butchery",
                    "Mincer; Sausage filler", "2024-03-15", "",
                    "Senior Line Leader", "Production Manager"])
        w.writerow(["John", "Smith", "john.smith@example.com", "0411 111 111",
                    "Packing", "employee", "Acme Staffing", "",
                    "15/03/2024", "",
                    "", "Packer"])
        # UTF-8 BOM so Excel auto-detects encoding when opening the .csv
        body = "﻿" + buf.getvalue()
        return Response(body, mimetype="text/csv",
                        headers={"Content-Disposition":
                                 "attachment; filename=users_template.csv"})

    @app.route("/admin/employees/bulk", methods=["GET"])
    @author_required
    def admin_employees_bulk():
        """Standalone bulk-upload page so QA/QC has an entry point.
        Admins can also use the inline form on /admin/employees."""
        return render_template("admin/users_bulk.html")

    @app.route("/admin/employees/upload", methods=["POST"])
    @author_required
    def admin_employees_upload():
        # QA/QC uploaders may not promote themselves or anyone else; the
        # role column is honored only for admin uploaders.
        actor_is_admin = current_user.is_admin
        back = (url_for("admin_employees") if actor_is_admin
                else url_for("admin_employees_bulk"))

        f = request.files.get("csv")
        if not f or not f.filename:
            flash("No file selected.", "danger")
            return redirect(back)
        try:
            text = f.stream.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            flash("CSV must be UTF-8 encoded.", "danger")
            return redirect(back)
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            flash("CSV is empty — no header row found.", "danger")
            return redirect(back)

        # Normalize header keys: lowercase + collapse internal whitespace to
        # single spaces so "First Name" / "first name" / "first  name" all map
        # to the same canonical key "first name".
        def _norm(h):
            return " ".join((h or "").lower().split())
        header_map = {_norm(h): h for h in reader.fieldnames}

        if "email" not in header_map:
            flash("CSV must have an 'Email' column.", "danger")
            return redirect(back)

        def cell(row, key):
            return (row.get(header_map.get(key, ""), "") or "").strip()

        created, skipped, invited = 0, 0, 0
        errors = []
        ERROR_CAP = 100
        seen_emails = set()

        # CSV row 1 is the header; data rows start at line 2.
        for row_num, row in enumerate(reader, start=2):
            email = cell(row, "email").lower()
            first_name = cell(row, "first name")
            last_name = cell(row, "last name")
            # Back-compat: accept a single "Name" column and split on first space.
            if not first_name and not last_name:
                legacy = cell(row, "name")
                if legacy:
                    parts = legacy.split(None, 1)
                    first_name = parts[0]
                    last_name = parts[1] if len(parts) > 1 else ""
            phone = cell(row, "phone")
            dept_name = cell(row, "department")
            employer_name = cell(row, "employer")
            start_raw = cell(row, "start date")
            term_raw = cell(row, "termination date")
            job_title = cell(row, "job title")
            position_name = cell(row, "position")

            def _reject(reason):
                nonlocal skipped
                skipped += 1
                if len(errors) < ERROR_CAP:
                    errors.append({"row": row_num,
                                   "email": email or "(blank)",
                                   "reason": reason})

            if not email:
                _reject("Email is missing")
                continue
            if "@" not in email:
                _reject("Email looks wrong (no @ sign)")
                continue
            if not first_name:
                _reject("First Name is missing")
                continue
            if not last_name:
                _reject("Last Name is missing")
                continue
            if not phone:
                _reject("Phone is missing")
                continue
            if not dept_name:
                _reject("Department is missing")
                continue
            if not employer_name:
                _reject("Employer is missing")
                continue
            if email in seen_emails:
                _reject("This email appears more than once in the CSV")
                continue
            existing = User.query.filter(
                func.lower(User.email) == email).first()
            if existing:
                _reject("This email is already in the system")
                seen_emails.add(email)
                continue
            try:
                start_date = parse_user_date(start_raw)
                termination_date = parse_user_date(term_raw)
            except ValueError as exc:
                _reject(f"Date format wrong ({exc}). Use YYYY-MM-DD or DD/MM/YYYY.")
                continue

            machines_raw = cell(row, "machines")
            role = cell(row, "role").lower() or "employee"
            if role not in VALID_ROLES:
                role = "employee"
            if not actor_is_admin:
                role = "employee"

            dept = get_or_create_department(dept_name)
            employer = get_or_create_employer(employer_name)

            machine_objs = []
            if machines_raw:
                for mname in [m.strip() for m in machines_raw.replace("|", ",").split(",") if m.strip()]:
                    m = Machine.query.filter_by(name=mname).first()
                    if not m:
                        m = Machine(name=mname)
                        db.session.add(m)
                        db.session.flush()
                    machine_objs.append(m)

            full_name = f"{first_name} {last_name}".strip()
            temp_pw = secrets.token_urlsafe(9)
            # Resolve position by name (case-insensitive). Missing position
            # isn't an error — leave the user unassigned and let the admin
            # set it up later via Edit user.
            position_id = None
            if position_name:
                pos = Position.query.filter(
                    func.lower(Position.name) == position_name.lower()).first()
                if pos is not None:
                    position_id = pos.id
            u = User(name=full_name, first_name=first_name, last_name=last_name,
                     email=email, role=role, phone=phone,
                     department_id=dept.id,
                     employer_id=employer.id,
                     start_date=start_date,
                     termination_date=termination_date,
                     job_title=job_title,
                     position_id=position_id)
            u.set_password(temp_pw)
            u.machines = machine_objs
            db.session.add(u)
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                _reject("This email is already in the system")
                seen_emails.add(email)
                continue
            seen_emails.add(email)
            try:
                notify_invite(u, temp_pw, app.config["APP_BASE_URL"])
                invited += 1
            except Exception:
                pass
            try:
                auto_assign_for_department(u, send_email=False)
            except Exception:
                current_app.logger.exception(
                    "bulk-upload auto-assign failed for %s", u.email)
            created += 1

        if created:
            log_audit("create", "user", None,
                      f"Bulk imported {created} user(s) from CSV "
                      f"(skipped {skipped}, invited {invited})")
            db.session.commit()

        # Pop a plain-English banner so the outcome is obvious at a glance,
        # not buried in the table below.
        if created and not skipped:
            flash(f"Added {created} staff member"
                  f"{'' if created == 1 else 's'}. All good.", "success")
        elif created and skipped:
            flash(f"Added {created} staff member"
                  f"{'' if created == 1 else 's'}, but skipped "
                  f"{skipped} row{'' if skipped == 1 else 's'} that had "
                  f"problems. See the list below for what to fix.", "warning")
        elif skipped:
            flash(f"Nothing was added. {skipped} row"
                  f"{' has' if skipped == 1 else 's have'} problems "
                  f"— see the list below, fix them, and re-upload.",
                  "danger")
        else:
            flash("The CSV had no data rows to import.", "warning")

        return render_template("admin/users_bulk_result.html",
                               created_count=created,
                               skipped_count=skipped,
                               invited_count=invited,
                               errors=errors,
                               error_cap=ERROR_CAP,
                               back_url=back)

    @app.route("/admin/employers", methods=["GET", "POST"])
    @author_required
    def admin_employers():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            if name and not Employer.query.filter_by(name=name).first():
                e = Employer(name=name)
                db.session.add(e)
                db.session.flush()
                log_audit("create", "employer", e.id,
                          f"Created employer '{e.name}'")
                db.session.commit()
                flash(f"Employer '{name}' added.", "success")
            elif name:
                flash("That employer already exists.", "warning")
            return redirect(url_for("admin_employers"))
        employers = Employer.query.order_by(Employer.name).all()
        return render_template("admin/employers.html", employers=employers)

    @app.route("/admin/employers/<int:eid>/delete", methods=["POST"])
    @author_required
    def admin_employer_delete(eid):
        e = db.session.get(Employer, eid) or abort(404)
        User.query.filter_by(employer_id=e.id).update({"employer_id": None})
        log_audit("delete", "employer", e.id,
                  f"Deleted employer '{e.name}'")
        db.session.delete(e)
        db.session.commit()
        flash(f"Employer '{e.name}' deleted.", "success")
        return redirect(url_for("admin_employers"))

    @app.route("/admin/departments", methods=["GET", "POST"])
    @author_required
    def admin_departments():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            if name and not Department.query.filter_by(name=name).first():
                d = Department(name=name)
                db.session.add(d)
                db.session.flush()
                log_audit("create", "department", d.id,
                          f"Created department '{d.name}'")
                db.session.commit()
                flash(f"Department '{name}' added.", "success")
            elif name:
                flash("That department already exists.", "warning")
            return redirect(url_for("admin_departments"))
        depts = Department.query.order_by(Department.name).all()
        return render_template("admin/departments.html", departments=depts)

    @app.route("/admin/departments/policies", methods=["GET", "POST"])
    @author_required
    def admin_department_policies():
        """Pick which modules each department auto-assigns to new staff."""
        departments = Department.query.order_by(Department.name).all()
        modules = (Module.query.filter_by(is_published=True)
                   .order_by(Module.title.asc()).all())
        if request.method == "POST":
            # Form posts checkbox `policy_<dept_id>_<module_id>`. Build the
            # desired set per department, then sync rows.
            desired = {d.id: set() for d in departments}
            for key in request.form.keys():
                if not key.startswith("policy_"):
                    continue
                try:
                    _, did_s, mid_s = key.split("_")
                    did, mid = int(did_s), int(mid_s)
                except (ValueError, IndexError):
                    continue
                if did in desired:
                    desired[did].add(mid)
            existing = DepartmentModulePolicy.query.all()
            existing_by_dept = {}
            for r in existing:
                existing_by_dept.setdefault(r.department_id, {})[r.module_id] = r
            added = 0
            removed = 0
            module_ids = {m.id for m in modules}
            for d in departments:
                want = desired.get(d.id, set()) & module_ids
                have = set(existing_by_dept.get(d.id, {}).keys())
                for mid in want - have:
                    db.session.add(DepartmentModulePolicy(
                        department_id=d.id, module_id=mid))
                    added += 1
                for mid in have - want:
                    db.session.delete(existing_by_dept[d.id][mid])
                    removed += 1
            if added or removed:
                log_audit("update", "department", None,
                          f"Department-module policies updated: "
                          f"{added} added, {removed} removed")
                db.session.commit()
                flash(f"Saved policies — {added} added, {removed} removed.",
                      "success")
            else:
                flash("No changes.", "info")
            return redirect(url_for("admin_department_policies"))

        rows = DepartmentModulePolicy.query.all()
        policy_set = {(r.department_id, r.module_id) for r in rows}
        return render_template("admin/department_policies.html",
                               departments=departments, modules=modules,
                               policy_set=policy_set)

    @app.route("/admin/departments/<int:did>/delete", methods=["POST"])
    @author_required
    def admin_department_delete(did):
        d = db.session.get(Department, did) or abort(404)
        User.query.filter_by(department_id=d.id).update({"department_id": None})
        log_audit("delete", "department", d.id,
                  f"Deleted department '{d.name}'")
        db.session.delete(d)
        db.session.commit()
        flash(f"Department '{d.name}' deleted.", "success")
        return redirect(url_for("admin_departments"))

    @app.route("/admin/machines", methods=["GET", "POST"])
    @author_required
    def admin_machines():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            if name and not Machine.query.filter_by(name=name).first():
                m = Machine(name=name)
                db.session.add(m)
                db.session.flush()
                log_audit("create", "machine", m.id,
                          f"Created machine '{m.name}'")
                db.session.commit()
                flash(f"Machine '{name}' added.", "success")
            elif name:
                flash("That machine already exists.", "warning")
            return redirect(url_for("admin_machines"))
        machines = (Machine.query
                    .options(db.joinedload(Machine.department),
                             db.selectinload(Machine.modules))
                    .order_by(Machine.name).all())
        return render_template("admin/machines.html", machines=machines)

    @app.route("/admin/machines/<int:mid>/edit", methods=["GET", "POST"])
    @author_required
    def admin_machine_edit(mid):
        m = db.session.get(Machine, mid) or abort(404)
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            if not name:
                flash("Machine name is required.", "danger")
                return redirect(url_for("admin_machine_edit", mid=mid))
            dupe = Machine.query.filter(Machine.name == name,
                                        Machine.id != m.id).first()
            if dupe is not None:
                flash("Another machine already has that name.", "danger")
                return redirect(url_for("admin_machine_edit", mid=mid))
            m.name = name
            dept_raw = request.form.get("department_id", "").strip()
            m.department_id = int(dept_raw) if dept_raw.isdigit() else None
            module_ids = [int(x) for x in request.form.getlist("module_ids")
                          if x.isdigit()]
            m.modules = (Module.query.filter(Module.id.in_(module_ids)).all()
                         if module_ids else [])
            log_audit("update", "machine", m.id,
                      f"Updated machine '{m.name}' "
                      f"({len(m.modules)} module link(s))")
            db.session.commit()
            flash(f"Machine '{m.name}' saved.", "success")
            return redirect(url_for("admin_machines"))
        departments = Department.query.order_by(Department.name).all()
        modules = (Module.query.filter_by(is_published=True)
                   .order_by(Module.title).all())
        return render_template("admin/machine_edit.html",
                               machine=m, departments=departments,
                               modules=modules)

    @app.route("/admin/machines/<int:mid>/delete", methods=["POST"])
    @author_required
    def admin_machine_delete(mid):
        m = db.session.get(Machine, mid) or abort(404)
        log_audit("delete", "machine", m.id,
                  f"Deleted machine '{m.name}'")
        db.session.delete(m)
        db.session.commit()
        flash(f"Machine '{m.name}' deleted.", "success")
        return redirect(url_for("admin_machines"))

    # assignments
    @app.route("/admin/assignments", methods=["GET", "POST"])
    @author_required
    def admin_assignments():
        if request.method == "POST":
            mid = int(request.form["module_id"])
            uids = [int(u) for u in request.form.getlist("user_ids")]
            m = db.session.get(Module, mid) or abort(404)
            created = 0
            now = datetime.utcnow()
            for uid in uids:
                u = db.session.get(User, uid)
                if not u:
                    continue
                if Assignment.query.filter_by(user_id=uid, module_id=mid).first():
                    continue
                a = Assignment(user_id=uid, module_id=mid,
                               assigned_at=now,
                               due_at=assignment_due_from(now))
                db.session.add(a)
                notify_assignment(u, m, app.config["APP_BASE_URL"])
                created += 1
            if created:
                log_audit("create", "assignment", m.id,
                          f"Assigned '{m.title}' to {created} user(s)")
            db.session.commit()
            flash(f"Assigned to {created} employee(s).", "success")
            return redirect(url_for("admin_assignments"))

        reset = process_expired_completions(app.config["APP_BASE_URL"])
        if reset:
            flash(f"{reset} completion(s) expired and were re-assigned.", "info")

        modules = Module.query.order_by(Module.title).all()
        role_order = db.case(
            (User.role == "employee", 0),
            (User.role == "qaqc", 1),
            (User.role == "admin", 2),
            else_=3,
        )
        employees = (User.query
                     .options(db.joinedload(User.department))
                     .filter(User.is_active_flag == True,
                             User.role.in_(("employee", "qaqc", "admin")))
                     .order_by(role_order, User.name).all())
        assignments = (Assignment.query
                       .options(db.joinedload(Assignment.user),
                                db.joinedload(Assignment.module))
                       .order_by(Assignment.assigned_at.desc()).all())

        status_map = {}
        for a in assignments:
            bucket = status_map.setdefault(a.module_id, {})
            bucket[a.user_id] = {
                "completed_at": a.completed_at.isoformat() if a.completed_at else None,
                "due_at": a.due_at.isoformat() if a.due_at else None,
                "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
            }

        return render_template("admin/assignments.html",
                               modules=modules, employees=employees,
                               assignments=assignments,
                               status_map=status_map,
                               now=datetime.utcnow())

    @app.route("/admin/assignments/<int:aid>/delete", methods=["POST"])
    @author_required
    def admin_assignment_delete(aid):
        a = db.session.get(Assignment, aid) or abort(404)
        u_email = a.user.email if a.user else f"user #{a.user_id}"
        m_title = a.module.title if a.module else f"module #{a.module_id}"
        log_audit("delete", "assignment", a.id,
                  f"Removed assignment of '{m_title}' from {u_email}")
        db.session.delete(a)
        db.session.commit()
        return redirect(url_for("admin_assignments"))

    # register / completion log
    def _register_query():
        return (Attempt.query
                .options(db.joinedload(Attempt.user).joinedload(User.department),
                         db.joinedload(Attempt.user).selectinload(User.machines),
                         db.joinedload(Attempt.module))
                .order_by(Attempt.created_at.desc()))

    @app.route("/admin/register")
    @author_required
    def admin_register():
        attempts = _register_query().all()
        return render_template("admin/register.html", attempts=attempts)

    @app.route("/admin/register.csv")
    @author_required
    def admin_register_csv():
        import csv, io
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["date", "employee", "email", "department", "machines",
                    "module", "score", "correct", "total", "passed"])
        for a in _register_query().all():
            w.writerow([a.created_at.strftime("%Y-%m-%d %H:%M"),
                        a.user.name, a.user.email,
                        a.user.department.name if a.user.department else "",
                        ", ".join(sorted(m.name for m in a.user.machines)),
                        a.module.title if a.module else "",
                        a.score, a.correct, a.total,
                        "yes" if a.passed else "no"])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition":
                                 "attachment; filename=register.csv"})

    @app.route("/admin/reminders/send", methods=["POST"])
    @author_required
    def admin_send_reminders():
        sent = 0
        for u in User.query.filter_by(role="employee", is_active_flag=True):
            pending = [a.module for a in u.assignments if a.completed_at is None]
            if pending:
                notify_reminder(u, pending, app.config["APP_BASE_URL"])
                sent += 1
        flash(f"Reminders sent to {sent} employee(s).", "success")
        return redirect(url_for("index"))

    # --- WHS register ---
    def _whs_expiring_soon_for_dashboard(limit=8):
        """Return WHS records expiring in the next 30 days or already overdue,
        sorted soonest first. Used by the admin dashboard widget."""
        today = datetime.utcnow().date()
        soon = today + timedelta(days=WHS_REMINDER_LOOKAHEAD_DAYS)
        rows = (WHSRecord.query
                .filter(WHSRecord.kind != "incident")
                .filter(WHSRecord.expires_on.isnot(None))
                .filter(WHSRecord.expires_on <= soon)
                .options(db.joinedload(WHSRecord.user))
                .order_by(WHSRecord.expires_on.asc())
                .limit(limit).all())
        out = []
        for r in rows:
            out.append({
                "record": r,
                "kind_label": WHS_KIND_SINGULAR.get(r.kind, "WHS record"),
                "status": whs_status_for(r),
                "days": (r.expires_on - today).days,
            })
        return out

    def _whs_counts():
        """Return {kind: {total, expiring, overdue}} for the landing cards."""
        today = datetime.utcnow().date()
        soon = today + timedelta(days=WHS_REMINDER_LOOKAHEAD_DAYS)
        out = {k: {"total": 0, "expiring": 0, "overdue": 0} for k in WHS_KINDS}
        for r in WHSRecord.query.all():
            if r.kind not in out:
                continue
            out[r.kind]["total"] += 1
            if r.kind == "incident" or r.expires_on is None:
                continue
            if r.expires_on < today:
                out[r.kind]["overdue"] += 1
            elif r.expires_on <= soon:
                out[r.kind]["expiring"] += 1
        return out

    @app.route("/admin/whs")
    @author_required
    def admin_whs():
        return render_template("admin/whs/landing.html",
                               counts=_whs_counts(),
                               kinds=WHS_KINDS,
                               kind_label=WHS_KIND_LABEL,
                               cooldown_days=WHS_REMINDER_COOLDOWN_DAYS)

    @app.route("/admin/whs/<kind>")
    @author_required
    def admin_whs_list(kind):
        if kind not in WHS_KINDS:
            abort(404)
        records = (WHSRecord.query
                   .filter_by(kind=kind)
                   .options(db.joinedload(WHSRecord.user),
                            db.joinedload(WHSRecord.reported_by))
                   .order_by(WHSRecord.expires_on.asc().nullslast(),
                             WHSRecord.created_at.desc()).all())
        rows = [(r, whs_status_for(r)) for r in records]
        return render_template("admin/whs/list.html",
                               kind=kind,
                               kind_label=WHS_KIND_LABEL[kind],
                               kind_singular=WHS_KIND_SINGULAR[kind],
                               rows=rows)

    @app.route("/admin/whs/new", methods=["GET", "POST"])
    @app.route("/admin/whs/<int:rid>/edit", methods=["GET", "POST"])
    @author_required
    def admin_whs_edit(rid=None):
        record = db.session.get(WHSRecord, rid) if rid else None
        if rid and record is None:
            abort(404)
        kind = (request.values.get("kind")
                or (record.kind if record else "high_risk_licence"))
        if kind not in WHS_KINDS:
            abort(404)

        if request.method == "POST":
            title = request.form.get("title", "").strip()
            user_id_raw = request.form.get("user_id", "").strip()
            notes = request.form.get("notes", "").strip()
            try:
                issued_on = parse_user_date(request.form.get("issued_on", ""))
                expires_on = parse_user_date(request.form.get("expires_on", ""))
                incident_date = parse_user_date(
                    request.form.get("incident_date", ""))
            except ValueError as exc:
                flash(f"Date format wrong: {exc}. Use YYYY-MM-DD.", "danger")
                return redirect(request.url)
            severity = (request.form.get("severity", "").strip()
                        if kind == "incident" else None)
            reported_by_id_raw = (request.form.get("reported_by_id", "").strip()
                                  if kind == "incident" else "")

            if not title:
                flash("Title is required.", "danger")
                return redirect(request.url)
            if kind != "incident" and not user_id_raw.isdigit():
                flash("Pick the staff member this record applies to.",
                      "danger")
                return redirect(request.url)
            if severity and severity not in WHS_SEVERITIES:
                severity = None

            if record is None:
                record = WHSRecord(kind=kind)
                db.session.add(record)
            record.title = title
            record.user_id = (int(user_id_raw)
                              if user_id_raw.isdigit() else None)
            record.notes = notes
            record.issued_on = issued_on
            record.expires_on = expires_on
            if kind == "incident":
                record.incident_date = incident_date
                record.severity = severity
                record.reported_by_id = (int(reported_by_id_raw)
                                         if reported_by_id_raw.isdigit()
                                         else current_user.id)
            else:
                record.incident_date = None
                record.severity = None
                record.reported_by_id = None

            doc_fs = request.files.get("document")
            if doc_fs and (doc_fs.filename or "").strip():
                try:
                    new_doc = save_upload(doc_fs, prefix="whs_")
                except ValueError as exc:
                    db.session.rollback()
                    flash(f"Document not saved: {exc}", "danger")
                    return redirect(request.url)
                old = record.document_filename
                record.document_filename = new_doc
                if old and old != new_doc:
                    prev = db.session.get(UploadedFile, old)
                    if prev is not None:
                        db.session.delete(prev)
            elif request.form.get("remove_document") and record.document_filename:
                old = record.document_filename
                record.document_filename = None
                prev = db.session.get(UploadedFile, old)
                if prev is not None:
                    db.session.delete(prev)

            db.session.flush()
            verb = "create" if rid is None else "update"
            log_audit(verb, "whs_record", record.id,
                      f"{verb.title()}d {WHS_KIND_SINGULAR[kind].lower()}: "
                      f"{record.title}")
            db.session.commit()
            flash(f"{WHS_KIND_SINGULAR[kind]} saved.", "success")
            return redirect(url_for("admin_whs_list", kind=kind))

        users = (User.query
                 .filter_by(is_active_flag=True)
                 .order_by(User.last_name, User.first_name).all())
        return render_template("admin/whs/edit.html",
                               record=record, kind=kind,
                               kind_label=WHS_KIND_LABEL[kind],
                               kind_singular=WHS_KIND_SINGULAR[kind],
                               users=users,
                               severities=WHS_SEVERITIES)

    @app.route("/admin/whs/<int:rid>/delete", methods=["POST"])
    @author_required
    def admin_whs_delete(rid):
        r = db.session.get(WHSRecord, rid) or abort(404)
        kind = r.kind
        title = r.title
        # Clean up the uploaded document blob too — same pattern as
        # set_user_photo / clear_user_photo. Idempotent.
        if r.document_filename:
            uf = db.session.get(UploadedFile, r.document_filename)
            if uf is not None:
                db.session.delete(uf)
        log_audit("delete", "whs_record", r.id,
                  f"Deleted {WHS_KIND_SINGULAR.get(kind, 'WHS record').lower()}: "
                  f"{title}")
        db.session.delete(r)
        db.session.commit()
        flash(f"{WHS_KIND_SINGULAR.get(kind, 'Record')} deleted.", "success")
        return redirect(url_for("admin_whs_list", kind=kind))

    @app.route("/admin/whs/run-reminders", methods=["POST"])
    @author_required
    def admin_whs_run_reminders():
        force = bool(request.form.get("force"))
        sent = process_whs_reminders(app.config.get("APP_BASE_URL", ""),
                                     force=force)
        if sent:
            flash(f"Sent {sent} WHS reminder email(s).", "success")
        else:
            flash("No reminders due — nothing sent.", "info")
        return redirect(url_for("admin_whs"))

    # --- employee ---
    @app.route("/my/modules")
    @login_required
    def my_modules():
        from collections import defaultdict

        assignments = (Assignment.query
                       .filter_by(user_id=current_user.id)
                       .order_by(Assignment.assigned_at.desc()).all())

        my_attempts = (Attempt.query
                       .filter_by(user_id=current_user.id)
                       .order_by(Attempt.created_at.desc()).all())

        per_module = defaultdict(list)
        for at in my_attempts:
            per_module[at.module_id].append(at)

        now = datetime.utcnow()
        soon_threshold = now + timedelta(days=7)

        rows = []
        completed = outstanding = overdue = due_soon = 0
        for a in assignments:
            module_attempts = per_module.get(a.module_id, [])
            best = max((x.score or 0 for x in module_attempts), default=None)
            last = module_attempts[0] if module_attempts else None

            if a.completed_at:
                status = "completed"
                completed += 1
            elif a.due_at and a.due_at < now:
                status = "overdue"
                outstanding += 1
                overdue += 1
            elif a.due_at and a.due_at < soon_threshold:
                status = "due_soon"
                outstanding += 1
                due_soon += 1
            else:
                status = "open"
                outstanding += 1

            rows.append({
                "assignment": a,
                "module": a.module,
                "status": status,
                "best_score": best,
                "last_attempt": last,
                "attempts": len(module_attempts),
            })

        total = len(assignments)
        total_attempts = len(my_attempts)
        passed_attempts = sum(1 for x in my_attempts if x.passed)
        avg_score = (sum(x.score or 0 for x in my_attempts) / total_attempts
                     ) if total_attempts else 0.0
        pass_rate = (100.0 * passed_attempts / total_attempts
                     ) if total_attempts else 0.0
        completion_rate = (100.0 * completed / total) if total else 0.0

        next_up = next((r for r in rows if r["status"] != "completed"), None)
        recent = my_attempts[:5]

        progress = {
            "total": total,
            "completed": completed,
            "outstanding": outstanding,
            "overdue": overdue,
            "due_soon": due_soon,
            "completion_rate": round(completion_rate, 1),
            "attempts": total_attempts,
            "avg_score": round(avg_score, 1),
            "pass_rate": round(pass_rate, 1),
        }

        return render_template("employee/dashboard.html",
                               rows=rows, progress=progress,
                               next_up=next_up, recent=recent)

    @app.route("/my/modules/<int:module_id>")
    @login_required
    def my_module(module_id):
        a = Assignment.query.filter_by(user_id=current_user.id,
                                       module_id=module_id).first() or abort(404)
        return render_template("employee/module.html",
                               module=module_for_assignment(a), assignment=a)

    @app.route("/my/modules/<int:module_id>/quiz", methods=["GET", "POST"])
    @login_required
    def my_quiz(module_id):
        a = Assignment.query.filter_by(user_id=current_user.id,
                                       module_id=module_id).first() or abort(404)
        m = module_for_assignment(a)
        if not m.questions:
            flash("This module has no quiz yet.", "info")
            return redirect(url_for("my_module", module_id=module_id))

        if request.method == "POST":
            answers = {}
            for q in m.questions:
                key = f"q_{q.id}"
                answers[str(q.id)] = request.form.getlist(key)
            correct, total, percent = score_attempt(m, answers)
            threshold = app.config.get("PASS_THRESHOLD", 80)
            passed = percent >= threshold
            attempt = Attempt(user_id=current_user.id, module_id=m.id,
                              score=percent, correct=correct, total=total,
                              passed=passed,
                              answers_json=json.dumps(answers))
            db.session.add(attempt)
            if passed and a.completed_at is None:
                a.completed_at = datetime.utcnow()
            db.session.commit()
            notify_attempt(current_user, m, attempt,
                           app.config.get("ADMIN_EMAIL", ""))
            return redirect(url_for("my_result", attempt_id=attempt.id))

        return render_template("employee/quiz.html", module=m)

    @app.route("/my/results/<int:attempt_id>")
    @login_required
    def my_result(attempt_id):
        a = db.session.get(Attempt, attempt_id) or abort(404)
        if a.user_id != current_user.id and not current_user.can_author:
            abort(403)
        module = db.session.get(Module, a.module_id)
        threshold = app.config.get("PASS_THRESHOLD", 80)
        try:
            answers = json.loads(a.answers_json or "{}")
        except (ValueError, TypeError):
            answers = {}
        review = attempt_review(module, answers) if module is not None else []
        return render_template("employee/result.html",
                               attempt=a, module=module, threshold=threshold,
                               review=review)

    # file serving (uploaded content) — DB-backed first, disk fallback for
    # legacy pre-migration files. DB-backed survives Render redeploys.
    @app.route("/uploads/<path:name>")
    @login_required
    def uploaded_file(name):
        uf = db.session.get(UploadedFile, name)
        if uf is not None:
            resp = Response(uf.data, mimetype=uf.mime_type)
            resp.headers["Cache-Control"] = "private, max-age=3600"
            resp.headers["Content-Length"] = str(len(uf.data))
            return resp
        try:
            return send_from_directory(app.config["UPLOAD_FOLDER"], name)
        except Exception:
            abort(404)


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
