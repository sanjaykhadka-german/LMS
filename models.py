from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


user_machines = db.Table(
    "user_machines",
    db.Column("user_id", db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    db.Column("machine_id", db.Integer, db.ForeignKey("machines.id", ondelete="CASCADE"), primary_key=True),
)


class Department(db.Model):
    __tablename__ = "departments"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)

    users = db.relationship("User", backref="department")


class Machine(db.Model):
    __tablename__ = "machines"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)


class User(UserMixin, db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="employee")  # admin | qaqc | employee
    is_active_flag = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    phone = db.Column(db.String(30), default="")
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id"), nullable=True)

    assignments = db.relationship("Assignment", backref="user", cascade="all, delete-orphan")
    attempts = db.relationship("Attempt", backref="user", cascade="all, delete-orphan")
    machines = db.relationship("Machine", secondary=user_machines, backref="users")

    def set_password(self, raw):
        self.password_hash = generate_password_hash(raw)

    def check_password(self, raw):
        return check_password_hash(self.password_hash, raw)

    @property
    def is_admin(self):
        return self.role == "admin"

    @property
    def is_qaqc(self):
        return self.role == "qaqc"

    @property
    def can_author(self):
        return self.role in ("admin", "qaqc")

    @property
    def role_label(self):
        return {"admin": "Administrator",
                "qaqc": "QA/QC",
                "employee": "Employee"}.get(self.role, self.role)


class Module(db.Model):
    __tablename__ = "modules"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_published = db.Column(db.Boolean, default=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    cover_path = db.Column(db.String(500), default="")

    created_by = db.relationship("User", foreign_keys=[created_by_id])
    content_items = db.relationship("ContentItem", backref="module",
                                    cascade="all, delete-orphan",
                                    order_by="ContentItem.position")
    questions = db.relationship("Question", backref="module",
                                cascade="all, delete-orphan",
                                order_by="Question.position")
    assignments = db.relationship("Assignment", backref="module",
                                  cascade="all, delete-orphan")
    media_items = db.relationship(
        "ModuleMedia", backref="module",
        cascade="all, delete-orphan",
        order_by="ModuleMedia.position",
    )


class ContentItem(db.Model):
    __tablename__ = "content_items"
    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)  # pdf | audio | video | text | link | image
    title = db.Column(db.String(255), nullable=False)
    body = db.Column(db.Text, default="")   # used for text/link
    file_path = db.Column(db.String(500), default="")  # legacy single-file slot
    position = db.Column(db.Integer, default=0)

    media_items = db.relationship(
        "ContentItemMedia",
        backref="content_item",
        cascade="all, delete-orphan",
        order_by="ContentItemMedia.position",
    )


class ContentItemMedia(db.Model):
    """Multiple images/videos per section. Coexists with the legacy
    ContentItem.file_path slot — both render in templates."""
    __tablename__ = "content_item_media"
    id = db.Column(db.Integer, primary_key=True)
    content_item_id = db.Column(db.Integer,
                                db.ForeignKey("content_items.id"),
                                nullable=False, index=True)
    file_path = db.Column(db.String(500), nullable=False)
    kind = db.Column(db.String(20), default="")  # image | video
    position = db.Column(db.Integer, default=0)


class ModuleMedia(db.Model):
    """Multiple images/videos for a module's title/cover area. Coexists with
    the legacy Module.cover_path slot — both render in templates."""
    __tablename__ = "module_media"
    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"),
                          nullable=False, index=True)
    file_path = db.Column(db.String(500), nullable=False)
    kind = db.Column(db.String(20), default="")  # image | video
    position = db.Column(db.Integer, default=0)


class Question(db.Model):
    __tablename__ = "questions"
    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"), nullable=False)
    prompt = db.Column(db.Text, nullable=False)
    kind = db.Column(db.String(20), default="single")  # single | multi
    position = db.Column(db.Integer, default=0)

    choices = db.relationship("Choice", backref="question",
                              cascade="all, delete-orphan",
                              order_by="Choice.position")


class Choice(db.Model):
    __tablename__ = "choices"
    id = db.Column(db.Integer, primary_key=True)
    question_id = db.Column(db.Integer, db.ForeignKey("questions.id"), nullable=False)
    text = db.Column(db.Text, nullable=False)
    is_correct = db.Column(db.Boolean, default=False)
    position = db.Column(db.Integer, default=0)


class Assignment(db.Model):
    __tablename__ = "assignments"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"), nullable=False)
    assigned_at = db.Column(db.DateTime, default=datetime.utcnow)
    due_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    version_id = db.Column(db.Integer,
                           db.ForeignKey("module_versions.id"),
                           nullable=True)

    version = db.relationship("ModuleVersion", foreign_keys=[version_id])

    __table_args__ = (db.UniqueConstraint("user_id", "module_id", name="uq_user_module"),)


class ModuleVersion(db.Model):
    __tablename__ = "module_versions"
    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"), nullable=False)
    version_number = db.Column(db.Integer, nullable=False)
    snapshot_json = db.Column(db.Text, nullable=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    summary = db.Column(db.String(255), default="")

    module = db.relationship(
        "Module",
        backref=db.backref("versions",
                           cascade="all, delete-orphan",
                           order_by="ModuleVersion.version_number.desc()"),
    )
    created_by = db.relationship("User", foreign_keys=[created_by_id])

    __table_args__ = (db.UniqueConstraint("module_id", "version_number",
                                          name="uq_module_version_number"),)


class Attempt(db.Model):
    __tablename__ = "attempts"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"), nullable=False)
    score = db.Column(db.Integer, default=0)        # percent 0-100
    correct = db.Column(db.Integer, default=0)
    total = db.Column(db.Integer, default=0)
    passed = db.Column(db.Boolean, default=False)
    answers_json = db.Column(db.Text, default="{}")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    module = db.relationship("Module", foreign_keys=[module_id])


class UploadedFile(db.Model):
    """Binary storage for persistent uploads (module covers, per-section
    images/video). Stored in the DB so files survive Render free-tier
    redeploys, which wipe the local filesystem. The primary key is the
    stored filename (e.g. "cover_abcdef12.jpg") so templates can keep
    referencing files by name."""
    __tablename__ = "uploaded_files"
    filename = db.Column(db.String(500), primary_key=True)
    mime_type = db.Column(db.String(120), nullable=False,
                          default="application/octet-stream")
    data = db.Column(db.LargeBinary, nullable=False)
    size = db.Column(db.Integer, default=0)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("users.id"),
                               nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)
