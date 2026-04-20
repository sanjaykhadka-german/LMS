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
                    Assignment, Attempt)
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
        bootstrap_admin(app)

    register_routes(app)
    return app


def bootstrap_admin(app):
    """Create an initial admin account if none exists."""
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
            return redirect(url_for("admin_dashboard" if current_user.is_admin
                                    else "my_modules"))
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

    # modules
    @app.route("/admin/modules")
    @admin_required
    def admin_modules():
        modules = Module.query.order_by(Module.created_at.desc()).all()
        return render_template("admin/modules.html", modules=modules)

    @app.route("/admin/modules/new", methods=["GET", "POST"])
    @admin_required
    def admin_module_new():
        if request.method == "POST":
            m = Module(title=request.form["title"].strip(),
                       description=request.form.get("description", ""))
            db.session.add(m)
            db.session.commit()
            flash("Module created.", "success")
            return redirect(url_for("admin_module_edit", module_id=m.id))
        return render_template("admin/module_form.html", module=None)

    @app.route("/admin/modules/<int:module_id>", methods=["GET", "POST"])
    @admin_required
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
    @admin_required
    def admin_module_delete(module_id):
        m = db.session.get(Module, module_id) or abort(404)
        db.session.delete(m)
        db.session.commit()
        flash("Module deleted.", "success")
        return redirect(url_for("admin_modules"))

    # content items
    @app.route("/admin/modules/<int:module_id>/content/add", methods=["POST"])
    @admin_required
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
    @admin_required
    def admin_content_delete(item_id):
        ci = db.session.get(ContentItem, item_id) or abort(404)
        mid = ci.module_id
        db.session.delete(ci)
        db.session.commit()
        return redirect(url_for("admin_module_edit", module_id=mid))

    # questions
    @app.route("/admin/modules/<int:module_id>/questions/add", methods=["POST"])
    @admin_required
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
    @admin_required
    def admin_question_delete(q_id):
        q = db.session.get(Question, q_id) or abort(404)
        mid = q.module_id
        db.session.delete(q)
        db.session.commit()
        return redirect(url_for("admin_module_edit", module_id=mid))

    # employees
    @app.route("/admin/employees")
    @admin_required
    def admin_employees():
        employees = User.query.filter_by(role="employee").order_by(User.name).all()
        return render_template("admin/employees.html", employees=employees)

    @app.route("/admin/employees/new", methods=["POST"])
    @admin_required
    def admin_employee_new():
        name = request.form["name"].strip()
        email = request.form["email"].strip().lower()
        if User.query.filter_by(email=email).first():
            flash("A user with this email already exists.", "danger")
            return redirect(url_for("admin_employees"))
        temp_pw = secrets.token_urlsafe(9)
        u = User(name=name, email=email, role="employee")
        u.set_password(temp_pw)
        db.session.add(u)
        db.session.commit()
        notify_invite(u, temp_pw, app.config["APP_BASE_URL"])
        flash(f"Employee created. Temporary password: {temp_pw}", "success")
        return redirect(url_for("admin_employees"))

    @app.route("/admin/employees/<int:uid>/toggle", methods=["POST"])
    @admin_required
    def admin_employee_toggle(uid):
        u = db.session.get(User, uid) or abort(404)
        u.is_active_flag = not u.is_active_flag
        db.session.commit()
        return redirect(url_for("admin_employees"))

    # assignments
    @app.route("/admin/assignments", methods=["GET", "POST"])
    @admin_required
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
    @admin_required
    def admin_assignment_delete(aid):
        a = db.session.get(Assignment, aid) or abort(404)
        db.session.delete(a)
        db.session.commit()
        return redirect(url_for("admin_assignments"))

    # register / completion log
    @app.route("/admin/register")
    @admin_required
    def admin_register():
        attempts = Attempt.query.order_by(Attempt.created_at.desc()).all()
        return render_template("admin/register.html", attempts=attempts)

    @app.route("/admin/register.csv")
    @admin_required
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
    @admin_required
    def admin_send_reminders():
        sent = 0
        for u in User.query.filter_by(role="employee", is_active_flag=True):
            pending = [a.module for a in u.assignments if a.completed_at is None]
            if pending:
                notify_reminder(u, pending, app.config["APP_BASE_URL"])
                sent += 1
        flash(f"Reminders sent to {sent} employee(s).", "success")
        return redirect(url_for("admin_dashboard"))

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
        if a.user_id != current_user.id and not current_user.is_admin:
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
