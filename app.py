import csv
import io
import json
import os
import secrets
from datetime import datetime
from functools import wraps

from flask import (Flask, render_template, redirect, url_for, request,
                   flash, abort, send_from_directory, Response)
from flask_login import (LoginManager, login_user, logout_user,
                         login_required, current_user)
from werkzeug.utils import secure_filename

from config import Config
from models import (db, User, Module, ContentItem, Question, Choice,
                    Assignment, Attempt, Department, Machine)
from email_service import (notify_invite, notify_assignment,
                           notify_attempt, notify_reminder)


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
        bootstrap_admin(app)

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

    for label, stmt in upgrades:
        try:
            with db.engine.begin() as conn:
                conn.execute(text(stmt))
            app.logger.warning("Schema upgrade applied: %s", label)
        except Exception as exc:
            app.logger.error("Schema upgrade FAILED for %s: %s", label, exc)


def bootstrap_admin(app):
    """Create an admin if none exists, or reset the admin password
    to the value of the ADMIN_RESET_PASSWORD env var if it is set."""
    admin_email = app.config.get("ADMIN_EMAIL") or "admin@example.com"
    reset_pw = os.environ.get("ADMIN_RESET_PASSWORD", "").strip()
    admin = User.query.filter_by(role="admin").first()

    if admin:
        if reset_pw:
            admin.set_password(reset_pw)
            db.session.commit()
            app.logger.warning("=" * 60)
            app.logger.warning("ADMIN PASSWORD RESET via ADMIN_RESET_PASSWORD env var")
            app.logger.warning("Email: %s", admin.email)
            app.logger.warning("Now UNSET the env var to avoid resets on every boot.")
            app.logger.warning("=" * 60)
        return

    temp_pw = reset_pw or secrets.token_urlsafe(9)
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
        stats = {
            "modules": Module.query.count(),
            "employees": User.query.filter_by(role="employee").count(),
            "assignments": Assignment.query.count(),
            "attempts": Attempt.query.count(),
        }
        recent = Attempt.query.order_by(Attempt.created_at.desc()).limit(10).all()
        return render_template("admin/dashboard.html", stats=stats, recent=recent)

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
        return render_template("admin/employees.html", employees=employees)

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
        temp_pw = secrets.token_urlsafe(9)
        u = User(name=name, email=email, role=role)
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
            for uid in uids:
                u = db.session.get(User, uid)
                if not u:
                    continue
                exists = Assignment.query.filter_by(user_id=uid, module_id=mid).first()
                if exists:
                    continue
                a = Assignment(user_id=uid, module_id=mid)
                db.session.add(a)
                notify_assignment(u, m, app.config["APP_BASE_URL"])
                created += 1
            db.session.commit()
            flash(f"Assigned to {created} employee(s).", "success")
            return redirect(url_for("admin_assignments"))

        modules = Module.query.order_by(Module.title).all()
        employees = User.query.filter_by(role="employee", is_active_flag=True)\
                              .order_by(User.name).all()
        assignments = Assignment.query.order_by(Assignment.assigned_at.desc()).all()
        return render_template("admin/assignments.html",
                               modules=modules, employees=employees,
                               assignments=assignments)

    @app.route("/admin/assignments/<int:aid>/delete", methods=["POST"])
    @author_required
    def admin_assignment_delete(aid):
        a = db.session.get(Assignment, aid) or abort(404)
        db.session.delete(a)
        db.session.commit()
        return redirect(url_for("admin_assignments"))

    # register / completion log
    @app.route("/admin/register")
    @author_required
    def admin_register():
        attempts = Attempt.query.order_by(Attempt.created_at.desc()).all()
        return render_template("admin/register.html", attempts=attempts)

    @app.route("/admin/register.csv")
    @author_required
    def admin_register_csv():
        import csv, io
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["date", "employee", "email", "module",
                    "score", "correct", "total", "passed"])
        for a in Attempt.query.order_by(Attempt.created_at.desc()).all():
            w.writerow([a.created_at.strftime("%Y-%m-%d %H:%M"),
                        a.user.name, a.user.email,
                        a.module_id and Module.query.get(a.module_id).title or "",
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

    # file serving (uploaded content)
    @app.route("/uploads/<path:name>")
    @login_required
    def uploaded_file(name):
        return send_from_directory(app.config["UPLOAD_FOLDER"], name)


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
