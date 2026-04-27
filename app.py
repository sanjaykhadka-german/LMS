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

from config import Config
from models import (db, User, Module, ContentItem, ContentItemMedia,
                    Question, Choice, Assignment, Attempt, Department,
                    Machine, UploadedFile)
from email_service import (notify_invite, notify_assignment,
                           notify_attempt, notify_reminder,
                           notify_password_reset)
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
    if "modules" in tables and not col_exists("modules", "created_by_id"):
        upgrades.append(("modules.created_by_id",
            "ALTER TABLE modules ADD COLUMN created_by_id INTEGER REFERENCES users(id)"))
    if "modules" in tables and not col_exists("modules", "cover_path"):
        upgrades.append(("modules.cover_path",
            "ALTER TABLE modules ADD COLUMN cover_path VARCHAR(500) DEFAULT ''"))

    for label, stmt in upgrades:
        try:
            with db.engine.begin() as conn:
                conn.execute(text(stmt))
            app.logger.warning("Schema upgrade applied: %s", label)
        except Exception as exc:
            app.logger.error("Schema upgrade FAILED for %s: %s", label, exc)


def assignment_due_from(dt):
    """Due date for an assignment assigned at `dt` (+ ASSIGNMENT_VALIDITY_DAYS)."""
    days = current_app.config.get("ASSIGNMENT_VALIDITY_DAYS", 180)
    return dt + timedelta(days=days)


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
    """Reset assignments whose completion is older than the validity window.
    Called lazily from admin_assignments GET. Returns count of rows reset."""
    days = current_app.config.get("ASSIGNMENT_VALIDITY_DAYS", 180)
    cutoff = datetime.utcnow() - timedelta(days=days)
    expired = (Assignment.query
               .filter(Assignment.completed_at.isnot(None))
               .filter(Assignment.completed_at < cutoff).all())
    now = datetime.utcnow()
    reset = 0
    for a in expired:
        a.completed_at = None
        a.assigned_at = now
        a.due_at = assignment_due_from(now)
        try:
            notify_assignment(a.user, a.module, base_url)
        except Exception:
            current_app.logger.exception(
                "expiry refresher email failed for assignment %s", a.id)
        reset += 1
    if reset:
        db.session.commit()
    return reset


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

    @app.route("/change-password", methods=["GET", "POST"])
    @login_required
    def change_password():
        if request.method == "POST":
            old = request.form.get("old", "")
            new = request.form.get("new", "")
            confirm = request.form.get("confirm", "")
            if not current_user.check_password(old):
                flash("Current password is incorrect.", "danger")
            elif len(new) < 8:
                flash("New password must be at least 8 characters.", "danger")
            elif new != confirm:
                flash("Passwords do not match.", "danger")
            else:
                current_user.set_password(new)
                db.session.commit()
                flash("Password updated.", "success")
                return redirect(url_for("index"))
        return render_template("change_password.html")

    # --- admin ---
    @app.route("/admin")
    @admin_required
    def admin_dashboard():
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

        # --- KPIs ---------------------------------------------------------
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

        # --- Daily time series -------------------------------------------
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

        # --- By module ---------------------------------------------------
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

        # --- By department ----------------------------------------------
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

        # --- Top learners & worst modules -------------------------------
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

        # --- Recent activity feed (unfiltered, like before) -------------
        recent = (Attempt.query.order_by(Attempt.created_at.desc())
                  .limit(10).all())

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

        departments = Department.query.order_by(Department.name).all()
        modules_list = Module.query.order_by(Module.title).all()

        return render_template(
            "admin/dashboard.html",
            stats=stats,
            recent=recent,
            chart_data=chart_data,
            top_learners=top_learners,
            worst_modules=worst_modules,
            filters={
                "from": from_date.isoformat(),
                "to": to_date.isoformat(),
                "dept": dept_id,
                "module": module_id,
            },
            departments=departments,
            all_modules=modules_list,
        )

    # --- qa/qc ---
    @app.route("/qaqc")
    @qaqc_required
    def qaqc_dashboard():
        stats = {
            "modules": Module.query.count(),
            "published": Module.query.filter_by(is_published=True).count(),
            "assignments": Assignment.query.count(),
            "attempts": Attempt.query.count(),
        }
        recent = Attempt.query.order_by(Attempt.created_at.desc()).limit(10).all()
        return render_template("qaqc/dashboard.html", stats=stats, recent=recent)

    # modules
    @app.route("/admin/modules")
    @author_required
    def admin_modules():
        modules = Module.query.order_by(Module.created_at.desc()).all()
        return render_template("admin/modules.html", modules=modules)

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

        return render_template(
            "admin/module_ai_studio.html",
            history=studio.get("history") or [],
            files=studio.get("files") or {},
            current_json=studio.get("current_json", ""),
            provider=provider,
            provider_label=provider_label,
            edit_module=edit_module,
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

    MODULE_EDITABLE_FIELDS = {"title", "description"}
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
        else:
            m.description = value or ""
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

    @app.route("/admin/modules/new", methods=["GET", "POST"])
    @author_required
    def admin_module_new():
        if request.method == "POST":
            m = Module(title=request.form["title"].strip(),
                       description=request.form.get("description", ""),
                       created_by_id=current_user.id)
            db.session.add(m)
            db.session.commit()
            flash("Module created.", "success")
            return redirect(url_for("admin_module_edit", module_id=m.id))
        return render_template("admin/module_form.html", module=None)

    @app.route("/admin/modules/<int:module_id>", methods=["GET", "POST"])
    @author_required
    def admin_module_edit(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        if request.method == "POST":
            m.title = request.form["title"].strip()
            m.description = request.form.get("description", "")
            m.is_published = bool(request.form.get("is_published"))
            db.session.commit()
            flash("Module saved.", "success")
        return render_template("admin/module_form.html", module=m)

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
                                   preview=True, preview_back=back)
        return render_template("employee/quiz.html",
                               module=m, preview=True, preview_back=back)

    @app.route("/admin/modules/<int:module_id>/self-assign", methods=["POST"])
    @author_required
    def admin_module_self_assign(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        a = Assignment.query.filter_by(user_id=current_user.id,
                                       module_id=module_id).first()
        if not a:
            a = Assignment(user_id=current_user.id, module_id=module_id)
            db.session.add(a)
            db.session.commit()
            flash(f"'{m.title}' assigned to you.", "success")
        else:
            flash("You already have this module assigned.", "info")
        return redirect(url_for("my_module", module_id=module_id))

    @app.route("/admin/modules/<int:module_id>/delete", methods=["POST"])
    @author_required
    def admin_module_delete(module_id):
        m = db.session.get(Module, module_id) or abort(404)
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
        db.session.commit()
        flash("Content added.", "success")
        return redirect(url_for("admin_module_edit", module_id=m.id))

    @app.route("/admin/content/<int:item_id>/delete", methods=["POST"])
    @author_required
    def admin_content_delete(item_id):
        ci = db.session.get(ContentItem, item_id) or abort(404)
        mid = ci.module_id
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
        db.session.commit()
        flash("Question added.", "success")
        return redirect(url_for("admin_module_edit", module_id=m.id))

    @app.route("/admin/questions/<int:q_id>/delete", methods=["POST"])
    @author_required
    def admin_question_delete(q_id):
        q = db.session.get(Question, q_id) or abort(404)
        mid = q.module_id
        db.session.delete(q)
        db.session.commit()
        return redirect(url_for("admin_module_edit", module_id=mid))

    # users (employees + admins)
    @app.route("/admin/employees")
    @admin_required
    def admin_employees():
        employees = (User.query
                     .options(db.joinedload(User.department),
                              db.selectinload(User.machines))
                     .order_by(User.role.desc(), User.name)
                     .all())
        departments = Department.query.order_by(Department.name).all()
        return render_template("admin/employees.html",
                               employees=employees, departments=departments)

    @app.route("/admin/employees/new", methods=["POST"])
    @admin_required
    def admin_employee_new():
        name = request.form["name"].strip()
        email = request.form["email"].strip().lower()
        role = request.form.get("role", "employee")
        if role not in VALID_ROLES:
            role = "employee"
        if User.query.filter_by(email=email).first():
            flash("A user with this email already exists.", "danger")
            return redirect(url_for("admin_employees"))
        dept_raw = request.form.get("department_id", "").strip()
        department_id = int(dept_raw) if dept_raw.isdigit() else None
        temp_pw = secrets.token_urlsafe(9)
        u = User(name=name, email=email, role=role, department_id=department_id)
        u.set_password(temp_pw)
        db.session.add(u)
        db.session.commit()
        notify_invite(u, temp_pw, app.config["APP_BASE_URL"])
        flash(f"{u.role_label} created. Temporary password: {temp_pw}", "success")
        return redirect(url_for("admin_employees"))

    @app.route("/admin/employees/<int:uid>/toggle", methods=["POST"])
    @admin_required
    def admin_employee_toggle(uid):
        u = db.session.get(User, uid) or abort(404)
        if u.id == current_user.id:
            flash("You cannot disable your own account.", "danger")
            return redirect(url_for("admin_employees"))
        u.is_active_flag = not u.is_active_flag
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
            u.role = new_role
            db.session.commit()
            flash(f"{u.name} is now {u.role_label}.", "success")
        return redirect(url_for("admin_employees"))

    @app.route("/admin/employees/<int:uid>/reset-password", methods=["POST"])
    @admin_required
    def admin_employee_reset_password(uid):
        u = db.session.get(User, uid) or abort(404)
        temp_pw = secrets.token_urlsafe(9)
        u.set_password(temp_pw)
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
    @admin_required
    def admin_employee_edit(uid):
        u = db.session.get(User, uid) or abort(404)
        if request.method == "POST":
            u.name = request.form.get("name", u.name).strip() or u.name
            u.phone = request.form.get("phone", "").strip()
            dept_raw = request.form.get("department_id", "").strip()
            u.department_id = int(dept_raw) if dept_raw else None
            machine_ids = [int(x) for x in request.form.getlist("machine_ids") if x.isdigit()]
            u.machines = Machine.query.filter(Machine.id.in_(machine_ids)).all() if machine_ids else []
            new_role = request.form.get("role", u.role)
            if new_role in VALID_ROLES and u.id != current_user.id:
                u.role = new_role
            db.session.commit()
            flash(f"{u.name} updated.", "success")
            return redirect(url_for("admin_employees"))
        departments = Department.query.order_by(Department.name).all()
        machines = Machine.query.order_by(Machine.name).all()
        return render_template("admin/employee_edit.html",
                               employee=u, departments=departments, machines=machines)

    @app.route("/admin/employees/<int:uid>")
    @admin_required
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
        return render_template("admin/employee_detail.html",
                               employee=u, rows=rows, counts=counts,
                               recent_attempts=recent_attempts,
                               pass_threshold=pass_threshold)

    @app.route("/admin/employees/upload", methods=["POST"])
    @admin_required
    def admin_employees_upload():
        f = request.files.get("csv")
        if not f or not f.filename:
            flash("No file selected.", "danger")
            return redirect(url_for("admin_employees"))
        try:
            text = f.stream.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            flash("CSV must be UTF-8 encoded.", "danger")
            return redirect(url_for("admin_employees"))
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames or "email" not in [h.lower().strip() for h in reader.fieldnames]:
            flash("CSV must have a header row with at least an 'email' column.", "danger")
            return redirect(url_for("admin_employees"))
        header_map = {h.lower().strip(): h for h in reader.fieldnames}

        def cell(row, key):
            return (row.get(header_map.get(key, ""), "") or "").strip()

        created, skipped, invited = 0, 0, 0
        for row in reader:
            email = cell(row, "email").lower()
            name = cell(row, "name") or email.split("@")[0]
            if not email or "@" not in email:
                skipped += 1
                continue
            if User.query.filter_by(email=email).first():
                skipped += 1
                continue
            phone = cell(row, "phone")
            dept_name = cell(row, "department")
            machines_raw = cell(row, "machines")
            role = cell(row, "role").lower() or "employee"
            if role not in VALID_ROLES:
                role = "employee"

            dept = None
            if dept_name:
                dept = Department.query.filter_by(name=dept_name).first()
                if not dept:
                    dept = Department(name=dept_name)
                    db.session.add(dept)
                    db.session.flush()

            machine_objs = []
            if machines_raw:
                for mname in [m.strip() for m in machines_raw.replace("|", ",").split(",") if m.strip()]:
                    m = Machine.query.filter_by(name=mname).first()
                    if not m:
                        m = Machine(name=mname)
                        db.session.add(m)
                        db.session.flush()
                    machine_objs.append(m)

            temp_pw = secrets.token_urlsafe(9)
            u = User(name=name, email=email, role=role, phone=phone,
                     department_id=dept.id if dept else None)
            u.set_password(temp_pw)
            u.machines = machine_objs
            db.session.add(u)
            db.session.commit()
            try:
                notify_invite(u, temp_pw, app.config["APP_BASE_URL"])
                invited += 1
            except Exception:
                pass
            created += 1

        flash(f"Imported {created} user(s); skipped {skipped}; invites sent: {invited}.", "success")
        return redirect(url_for("admin_employees"))

    @app.route("/admin/departments", methods=["GET", "POST"])
    @admin_required
    def admin_departments():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            if name and not Department.query.filter_by(name=name).first():
                db.session.add(Department(name=name))
                db.session.commit()
                flash(f"Department '{name}' added.", "success")
            elif name:
                flash("That department already exists.", "warning")
            return redirect(url_for("admin_departments"))
        depts = Department.query.order_by(Department.name).all()
        return render_template("admin/departments.html", departments=depts)

    @app.route("/admin/departments/<int:did>/delete", methods=["POST"])
    @admin_required
    def admin_department_delete(did):
        d = db.session.get(Department, did) or abort(404)
        User.query.filter_by(department_id=d.id).update({"department_id": None})
        db.session.delete(d)
        db.session.commit()
        flash(f"Department '{d.name}' deleted.", "success")
        return redirect(url_for("admin_departments"))

    @app.route("/admin/machines", methods=["GET", "POST"])
    @admin_required
    def admin_machines():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            if name and not Machine.query.filter_by(name=name).first():
                db.session.add(Machine(name=name))
                db.session.commit()
                flash(f"Machine '{name}' added.", "success")
            elif name:
                flash("That machine already exists.", "warning")
            return redirect(url_for("admin_machines"))
        machines = Machine.query.order_by(Machine.name).all()
        return render_template("admin/machines.html", machines=machines)

    @app.route("/admin/machines/<int:mid>/delete", methods=["POST"])
    @admin_required
    def admin_machine_delete(mid):
        m = db.session.get(Machine, mid) or abort(404)
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

    # --- employee ---
    @app.route("/my/modules")
    @login_required
    def my_modules():
        assignments = Assignment.query.filter_by(user_id=current_user.id)\
                                      .order_by(Assignment.assigned_at.desc()).all()
        return render_template("employee/dashboard.html", assignments=assignments)

    @app.route("/my/modules/<int:module_id>")
    @login_required
    def my_module(module_id):
        a = Assignment.query.filter_by(user_id=current_user.id,
                                       module_id=module_id).first() or abort(404)
        return render_template("employee/module.html",
                               module=a.module, assignment=a)

    @app.route("/my/modules/<int:module_id>/quiz", methods=["GET", "POST"])
    @login_required
    def my_quiz(module_id):
        a = Assignment.query.filter_by(user_id=current_user.id,
                                       module_id=module_id).first() or abort(404)
        m = a.module
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
        return render_template("employee/result.html",
                               attempt=a, module=module, threshold=threshold)

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
