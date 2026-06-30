"""Email payslips (Session 22 #5).

Outbound email via the Python standard library (``smtplib`` + ``email``) — no new
dependency, which dodges the office TLS-inspecting proxy's pip-install problem.
SMTP is fully config-driven (see ``Settings.SMTP_*``). When unconfigured the whole
feature is a safe no-op that reports "not configured".

This module is intentionally API-layer-free: callers (the payslip endpoints and the
scheduler) pass in already-built payslip *contexts* (the dicts from
``payslip._build_response``); we only generate the PDF, build the message and send.
"""

import smtplib
from email.message import EmailMessage
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import AuditLog, Employee
from app.services.pdf_generator import generate_pdf


def smtp_configured() -> bool:
    """True when enough SMTP settings are present to attempt a send."""
    return bool(settings.SMTP_HOST.strip())


def _from_addr() -> str:
    return (settings.SMTP_FROM or settings.SMTP_USER or "").strip()


def _mask_email(email: str) -> str:
    """j***@example.com — never echo a full address back to the UI/audit."""
    email = (email or "").strip()
    if "@" not in email:
        return email
    local, _, domain = email.partition("@")
    head = local[0] if local else ""
    return f"{head}***@{domain}"


def _subject_body(ctx: dict[str, Any]) -> tuple[str, str]:
    entity = ctx.get("entity_name") or "Udyogi"
    subject = f"Payslip — {ctx['month_name']} {ctx['year']} — {entity}"
    body = (
        f"Dear {ctx.get('name') or 'Employee'},\n\n"
        f"Please find attached your payslip for {ctx['month_name']} {ctx['year']}.\n\n"
        f"Net pay: Rs {int(ctx.get('net_pay') or 0):,}\n\n"
        f"This is an automated email from {entity}. Please do not reply.\n"
        f"For any queries, contact your HR department.\n"
    )
    return subject, body


def _send_one(to_addr: str, subject: str, body: str,
              pdf_bytes: Optional[bytes], filename: str) -> None:
    """Send a single message (optionally with a PDF attachment). Raises on failure."""
    msg = EmailMessage()
    msg["From"] = _from_addr()
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    if pdf_bytes is not None:
        msg.add_attachment(pdf_bytes, maintype="application", subtype="pdf", filename=filename)

    with smtplib.SMTP(settings.SMTP_HOST.strip(), settings.SMTP_PORT, timeout=30) as smtp:
        if settings.SMTP_TLS:
            smtp.starttls()
        if settings.SMTP_USER.strip():
            smtp.login(settings.SMTP_USER.strip(), settings.SMTP_PASSWORD)
        smtp.send_message(msg)


def _emails_for(db: Session, codes: list[str]) -> dict[str, str]:
    """One query: emp_code -> email (stripped) for the given codes."""
    rows = (
        db.query(Employee.emp_code, Employee.email)
        .filter(Employee.emp_code.in_(codes))
        .all()
    )
    return {code: (email or "").strip() for code, email in rows}


def preview_recipients(db: Session, contexts: list[dict[str, Any]]) -> dict[str, Any]:
    """Dry run — who would receive an email and who would be skipped (no email).
    Sends nothing."""
    emails = _emails_for(db, [c["emp_code"] for c in contexts])
    recipients, skipped = [], []
    for ctx in contexts:
        email = emails.get(ctx["emp_code"], "")
        entry = {"emp_code": ctx["emp_code"], "name": ctx.get("name") or ""}
        if email:
            recipients.append({**entry, "email": _mask_email(email)})
        else:
            skipped.append(entry)
    return {"total": len(contexts), "recipients": recipients, "skipped": skipped}


def send_test(db: Session, *, actor: str, entity_id: str, year: int, month: int,
              contexts: list[dict[str, Any]], to_addr: str) -> dict[str, Any]:
    """Send ONE sample payslip (the first employee's) to ``to_addr`` so an admin can
    confirm SMTP + formatting before a real run. Audited; allowed on any status."""
    if not smtp_configured():
        return {"ok": False, "error": "Email is not configured on the server."}
    if not contexts:
        return {"ok": False, "error": "No payroll rows to build a sample from."}
    to_addr = (to_addr or "").strip()
    if "@" not in to_addr:
        return {"ok": False, "error": "Enter a valid email address for the test send."}

    ctx = contexts[0]
    subject, body = _subject_body(ctx)
    try:
        pdf = generate_pdf(ctx)
        _send_one(to_addr, f"[TEST] {subject}", body, pdf, "payslip_sample.pdf")
    except Exception as exc:  # noqa: BLE001 — surface the SMTP error to the admin
        return {"ok": False, "error": f"Test send failed: {exc}"}

    db.add(AuditLog(
        user_code=actor, action="PAYSLIP_EMAIL_TEST", table_name="payroll_months",
        record_id=f"{entity_id}:{year}-{month:02d}",
        new_values={"test_to": _mask_email(to_addr), "sample_emp": ctx["emp_code"]},
    ))
    db.commit()
    return {"ok": True, "test_to": _mask_email(to_addr)}


def deliver_payslips(db: Session, *, actor: str, entity_id: str, year: int, month: int,
                     contexts: list[dict[str, Any]]) -> dict[str, Any]:
    """Email every employee their payslip PDF. Employees with no email on file are
    skipped and reported. One audit row records the batch outcome (rule 1)."""
    if not smtp_configured():
        return {"ok": False, "error": "Email is not configured on the server."}

    emails = _emails_for(db, [c["emp_code"] for c in contexts])
    sent: list[dict] = []
    skipped: list[dict] = []
    failed: list[dict] = []

    for ctx in contexts:
        code = ctx["emp_code"]
        email = emails.get(code, "")
        if not email:
            skipped.append({"emp_code": code, "name": ctx.get("name") or ""})
            continue
        try:
            pdf = generate_pdf(ctx)
            subject, body = _subject_body(ctx)
            _send_one(email, subject, body, pdf,
                      f"payslip_{code}_{year}_{month:02d}.pdf")
            sent.append({"emp_code": code, "email": _mask_email(email)})
        except Exception as exc:  # noqa: BLE001 — one bad address never aborts the batch
            failed.append({"emp_code": code, "error": str(exc)})

    db.add(AuditLog(
        user_code=actor, action="PAYSLIP_EMAIL", table_name="payroll_months",
        record_id=f"{entity_id}:{year}-{month:02d}",
        new_values={
            "sent": len(sent), "skipped": len(skipped), "failed": len(failed),
            "total": len(contexts),
            "skipped_codes": [s["emp_code"] for s in skipped],
            "failed_codes": [f["emp_code"] for f in failed],
        },
    ))
    db.commit()
    return {
        "ok": True, "total": len(contexts),
        "sent": len(sent), "skipped": skipped, "failed": failed,
    }
