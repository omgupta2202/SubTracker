"""
Email helper for the auth module.

Provider is selected by the EMAIL_PROVIDER env var:
  - "resend" (default if RESEND_API_KEY is set) — recommended, no 2FA needed
  - "smtp"   — requires Gmail App Password or another SMTP relay

Resend env vars:  RESEND_API_KEY, SMTP_FROM
SMTP env vars:    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
"""
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

_HTML_TEMPLATE = """
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
  <h2 style="color:#1a1a1a;margin-bottom:8px">Confirm your email</h2>
  <p style="color:#555;margin-bottom:24px">
    Click the button below to activate your SubTracker account.
    This link expires in <strong>24 hours</strong>.
  </p>
  <a href="{url}"
     style="background:#7c3aed;color:#fff;text-decoration:none;
            padding:12px 28px;border-radius:8px;font-weight:600;
            display:inline-block;letter-spacing:.3px">
    Confirm Email
  </a>
  <p style="color:#aaa;font-size:12px;margin-top:28px;word-break:break-all">
    Or copy this link:<br>{url}
  </p>
</div>
"""


def send_confirmation(to_email: str, confirm_url: str) -> None:
    """Send an account-confirmation email. Auto-selects provider."""
    send_email(
        to_email,
        "Confirm your SubTracker account",
        _HTML_TEMPLATE.format(url=confirm_url),
    )


def send_email(to_email: str, subject: str, html: str) -> None:
    """Generic email send used by both auth confirmations and reminder digests."""
    if os.environ.get("RESEND_API_KEY"):
        _send_via_resend(to_email, subject, html)
    else:
        _send_via_smtp(to_email, subject, html)


def _send_via_resend(to_email: str, subject: str, html: str) -> None:
    try:
        import resend  # pip install resend
    except ImportError:
        raise RuntimeError("resend package not installed — run: pip install resend")

    resend.api_key = os.environ["RESEND_API_KEY"]
    resend.Emails.send({
        "from":    os.environ.get("SMTP_FROM", "onboarding@resend.dev"),
        "to":      to_email,
        "subject": subject,
        "html":    html,
    })


def _send_via_smtp(to_email: str, subject: str, html: str) -> None:
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")
    from_addr = os.environ.get("SMTP_FROM", smtp_user)

    msg            = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_addr
    msg["To"]      = to_email
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_addr, to_email, msg.as_string())
