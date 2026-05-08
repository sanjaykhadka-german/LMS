import logging
import requests
from flask import current_app

log = logging.getLogger(__name__)


def send_email(to, subject, html, text=None):
    """Send email via Resend. Silently logs if no API key is configured."""
    api_key = current_app.config.get("RESEND_API_KEY", "")
    mail_from = current_app.config.get("MAIL_FROM")
    from_name = current_app.config.get("MAIL_FROM_NAME", "")
    sender = f"{from_name} <{mail_from}>" if from_name else mail_from

    if not api_key:
        log.warning("[email disabled] to=%s subject=%s", to, subject)
        return False

    payload = {
        "from": sender,
        "to": [to] if isinstance(to, str) else to,
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text

    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}",
                     "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if r.status_code >= 300:
            log.error("Resend error %s: %s", r.status_code, r.text)
            return False
        return True
    except Exception as e:
        log.exception("Resend call failed: %s", e)
        return False


def notify_invite(user, temp_password, base_url):
    html = f"""
    <p>Hi {user.name},</p>
    <p>You have been invited to German Butchery's training portal.</p>
    <p><b>Login:</b> <a href="{base_url}/login">{base_url}/login</a><br>
       <b>Email:</b> {user.email}<br>
       <b>Temporary password:</b> {temp_password}</p>
    <p>Please change your password after logging in.</p>
    """
    return send_email(user.email, "Your training portal account", html)


def notify_password_reset(user, temp_password, base_url):
    html = f"""
    <p>Hi {user.name},</p>
    <p>An administrator has reset your password for the German Butchery training portal.</p>
    <p><b>Login:</b> <a href="{base_url}/login">{base_url}/login</a><br>
       <b>Email:</b> {user.email}<br>
       <b>New temporary password:</b> {temp_password}</p>
    <p>Please change your password after logging in.</p>
    """
    return send_email(user.email, "Your training portal password was reset", html)


def notify_assignment(user, module, base_url):
    html = f"""
    <p>Hi {user.name},</p>
    <p>A new training module has been assigned to you:
       <b>{module.title}</b>.</p>
    <p>Please complete it at your earliest convenience:
       <a href="{base_url}/my/modules">{base_url}/my/modules</a></p>
    """
    return send_email(user.email, f"New training: {module.title}", html)


def notify_attempt(user, module, attempt, admin_email):
    verdict = "PASSED" if attempt.passed else "FAILED"
    emp_html = f"""
    <p>Hi {user.name},</p>
    <p>You have completed <b>{module.title}</b>.</p>
    <p>Score: <b>{attempt.score}%</b> ({attempt.correct}/{attempt.total}) — <b>{verdict}</b>.</p>
    """
    send_email(user.email, f"Result: {module.title} — {verdict}", emp_html)

    if admin_email:
        admin_html = f"""
        <p>{user.name} ({user.email}) attempted <b>{module.title}</b>.</p>
        <p>Score: <b>{attempt.score}%</b> ({attempt.correct}/{attempt.total}) — <b>{verdict}</b>.</p>
        """
        send_email(admin_email,
                   f"[Training] {user.name} — {module.title} — {verdict}",
                   admin_html)


def notify_reminder(user, outstanding, base_url):
    items = "".join(f"<li>{m.title}</li>" for m in outstanding)
    html = f"""
    <p>Hi {user.name},</p>
    <p>You have outstanding training modules:</p>
    <ul>{items}</ul>
    <p><a href="{base_url}/my/modules">Open your portal</a></p>
    """
    return send_email(user.email, "Reminder: outstanding training", html)


def notify_whs_expiry(user, record, kind_label, base_url):
    """Email a staff member that their WHS record (licence / warden / first
    aider) expires soon. `kind_label` is a human-readable singular form
    (e.g. "High-risk licence")."""
    expires = (record.expires_on.strftime("%d %b %Y")
               if record.expires_on else "soon")
    html = f"""
    <p>Hi {user.name},</p>
    <p>Your {kind_label.lower()} <b>{record.title}</b> expires on
    <b>{expires}</b>.</p>
    <p>Please start renewal now and let your manager know once it's done.</p>
    """
    return send_email(user.email,
                      f"Reminder: {kind_label} expires {expires}",
                      html)
