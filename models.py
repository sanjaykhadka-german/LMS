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

    created_by = db.relationship("User", foreign_keys=[created_by_id])
    content_items = db.relationship("ContentItem", backref="module",
                                    cascade="all, delete-orphan",
                                    order_by="ContentItem.position")
    questions = db.relationship("Question", backref="module",
                                cascade="all, delete-orphan",
                                order_by="Question.position")
    assignments = db.relationship("Assignment", backref="module",
                                  cascade="all, delete-orphan")


class ContentItem(db.Model):
    __tablename__ = "content_items"
    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey("modules.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)  # pdf | audio | video | text | link | image
    title = db.Column(db.String(255), nullable=False)
    body = db.Column(db.Text, default="")   # used for text/link
    file_path = db.Column(db.String(500), default="")  # for uploaded files
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

    __table_args__ = (db.UniqueConstraint("user_id", "module_id", name="uq_user_module"),)


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
