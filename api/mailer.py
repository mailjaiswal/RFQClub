"""Transactional email for RFQClub auth (sign-in codes + password-reset links).

Two providers, no new dependency:
  * **Resend** (default when `RESEND_API_KEY` is set) — plain HTTPS POST via
    httpx, which we already ship for the Google tokeninfo check.
  * **SMTP** (used when `SMTP_HOST` is set and no Resend key exists) — stdlib
    `smtplib` with STARTTLS or implicit TLS.

Delivery mode comes from `EMAIL_MODE`:
  * `dev`   — nothing is sent; the caller surfaces the secret on-screen (demo).
  * `auto`  — Resend if configured, else SMTP if configured, else dev.
  * `resend` / `smtp` — force that provider (fails loudly if it isn't set up).

A send failure raises `MailError`; the caller decides how to degrade (we fall
back to on-screen delivery rather than silently swallowing the code).
"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage

import httpx

import config


class MailError(RuntimeError):
    """Raised when an email could not be delivered."""


def _display_addr() -> str:
    return config.EMAIL_FROM


def provider() -> str:
    """Resolve the effective delivery provider: 'resend' | 'smtp' | 'dev'."""
    mode = (config.EMAIL_MODE or "auto").strip().lower()
    if mode == "dev":
        return "dev"
    if mode == "resend":
        if not config.RESEND_API_KEY:
            raise MailError("EMAIL_MODE=resend but RESEND_API_KEY is not set")
        return "resend"
    if mode == "smtp":
        if not config.SMTP_HOST:
            raise MailError("EMAIL_MODE=smtp but SMTP_HOST is not set")
        return "smtp"
    if config.RESEND_API_KEY:
        return "resend"
    if config.SMTP_HOST:
        return "smtp"
    return "dev"


def is_configured() -> bool:
    return provider() != "dev"


def _send_resend(to: str, subject: str, text: str, html: str) -> None:
    try:
        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={"from": _display_addr(), "to": [to], "subject": subject,
                  "html": html, "text": text},
            timeout=12.0,
        )
    except httpx.HTTPError as exc:
        raise MailError(f"Resend request failed: {exc}") from exc
    if r.status_code >= 400:
        raise MailError(f"Resend {r.status_code}: {r.text[:200]}")


def _send_smtp(to: str, subject: str, text: str, html: str) -> None:
    msg = EmailMessage()
    msg["From"] = _display_addr()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    security = (config.SMTP_SECURITY or "starttls").strip().lower()
    port = config.SMTP_PORT or (465 if security == "ssl" else 587)
    try:
        if security == "ssl":
            server = smtplib.SMTP_SSL(config.SMTP_HOST, port, timeout=20,
                                      context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(config.SMTP_HOST, port, timeout=20)
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        with server:
            if config.SMTP_USERNAME:
                server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            server.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        raise MailError(f"SMTP send failed: {exc}") from exc


def send(to: str, subject: str, text: str, html: str | None = None) -> None:
    """Deliver one email. Raises MailError on any failure."""
    if not to or "@" not in to:
        raise MailError(f"Refusing to send to invalid address {to!r}")
    html = html or f"<pre style='font:14px/1.5 ui-monospace,monospace'>{text}</pre>"
    p = provider()
    if p == "dev":
        raise MailError("No email provider configured (set RESEND_API_KEY or SMTP_HOST)")
    if p == "resend":
        _send_resend(to, subject, text, html)
    else:
        _send_smtp(to, subject, text, html)


# ---- templates -----------------------------------------------------------

_BRAND = "#3F4397"


def _wrap(title: str, body_html: str) -> str:
    return (
        "<div style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;"
        "max-width:520px;margin:0 auto;padding:28px 22px;border:1px solid #E4E1DA;"
        "border-radius:14px'>"
        f"<div style='font-size:13px;letter-spacing:1.4px;text-transform:uppercase;"
        f"color:{_BRAND};font-weight:700'>RFQClub</div>"
        f"<h1 style='font-size:20px;margin:12px 0 6px;color:#1D1D1F'>{title}</h1>"
        f"<div style='font-size:14px;line-height:1.6;color:#3F3F46'>{body_html}</div>"
        "<div style='margin-top:20px;font-size:12px;color:#8A857A'>Automated message "
        "from RFQClub — please don't reply to this email.</div></div>"
    )


def send_otp(to: str, code: str, ttl_minutes: int) -> None:
    subject = f"Your RFQClub sign-in code: {code}"
    text = (
        f"Your RFQClub verification code is {code}.\n\n"
        f"It expires in {ttl_minutes} minutes. If you didn't request this, you can "
        "ignore this email — your account stays protected."
    )
    html = _wrap(
        "Your verification code",
        f"<div style='font-size:30px;font-weight:800;letter-spacing:8px;color:{_BRAND};"
        f"margin:8px 0 14px'>{code}</div>"
        f"<p>It expires in <b>{ttl_minutes} minutes</b>. Enter it on the RFQClub "
        "sign-in screen to continue.</p>"
        "<p style='color:#8A857A'>Didn't request a code? Ignore this email.</p>",
    )
    send(to, subject, text, html)


def send_reset_link(to: str, link: str, ttl_minutes: int) -> None:
    subject = "Reset your RFQClub password"
    text = (
        "We got a request to reset your RFQClub password.\n\n"
        f"Open this link to choose a new password:\n{link}\n\n"
        f"The link expires in {ttl_minutes} minutes and works once. If you didn't "
        "ask for a reset, ignore this email — your password stays unchanged."
    )
    html = _wrap(
        "Reset your password",
        f"<p>Use the button below to choose a new password. It expires in "
        f"<b>{ttl_minutes} minutes</b> and can only be used once.</p>"
        f"<p style='margin:18px 0'><a href='{link}' style='background:{_BRAND};"
        "color:#fff;padding:11px 18px;border-radius:999px;text-decoration:none;"
        "font-weight:600'>Reset password</a></p>"
        f"<p style='font-size:12px;color:#8A857A'>Or paste this into your browser:"
        f"<br>{link}</p>"
        "<p style='color:#8A857A'>Didn't request this? Ignore this email and your "
        "password stays unchanged.</p>",
    )
    send(to, subject, text, html)
