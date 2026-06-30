import asyncio
import contextlib
from datetime import date, datetime, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.db import SessionLocal
from app.services.leave_engine import materialize_all_leave_balances
from app.api.admin import router as admin_router
from app.api.attendance import router as attendance_router
from app.api.auth import router as auth_router
from app.api.biometric import biometric_router, iclock_router
from app.api.employees import router as employees_router
from app.api.leave import router as leave_router
from app.api.locations import router as locations_router
from app.api.loans import router as loans_router
from app.api.meta import router as meta_router
from app.api.payslip import router as payslip_router, payroll_router

def _materialize_leave_safe() -> None:
    """Resolve+write-through derived leave entitlement for all active employees."""
    db = SessionLocal()
    try:
        materialize_all_leave_balances(db, date.today())
    except Exception:  # noqa: BLE001 — never let the refresh crash the app
        db.rollback()
    finally:
        db.close()


def _auto_email_payslips_safe() -> None:
    """Auto-email the PREVIOUS month's payslips for every entity (Session 22 #5).
    Runs on EMAIL_PAYSLIP_DAY. Only fully-LOCKED months are sent; an unlocked month
    is skipped and an alert is recorded in audit_log. Idempotent per (entity, month)
    via an existing PAYSLIP_EMAIL audit row, so a manual send earlier also suppresses
    the auto-send. Never raises — a bad batch must not crash the scheduler."""
    if not settings.SMTP_HOST.strip():
        return  # email disabled — nothing to do

    # Imported lazily to avoid a circular import at module load.
    from app.api.payslip import email_payslips_for_locked_month
    from app.models.employee import AuditLog, Entity

    db = SessionLocal()
    try:
        today = date.today()
        pm_year, pm_month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
        for (entity_id,) in db.query(Entity.id).all():
            record_id = f"{entity_id}:{pm_year}-{pm_month:02d}"
            already = (
                db.query(AuditLog.id)
                .filter(AuditLog.action == "PAYSLIP_EMAIL", AuditLog.record_id == record_id)
                .first()
            )
            if already:
                continue  # already emailed (auto or manual)

            res = email_payslips_for_locked_month(
                db, actor="SYSTEM", entity_id=entity_id, year=pm_year, month=pm_month,
            )
            if res.get("ok"):
                continue
            if res.get("reason") == "not_locked":
                # Skip + alert: record once so HR can see the auto-send was withheld.
                db.add(AuditLog(
                    user_code="SYSTEM", action="PAYSLIP_EMAIL_SKIPPED",
                    table_name="payroll_months", record_id=record_id,
                    new_values={"reason": "month not locked on the scheduled day",
                                "employee_count": res.get("employee_count", 0)},
                ))
                db.commit()
            # reason == "no_rows" → nothing was run for this entity that month; stay quiet.
    except Exception:  # noqa: BLE001 — never let the scheduler crash the app
        db.rollback()
    finally:
        db.close()


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI):
    # Keep leave balances fresh even with zero user activity (15.7): once at
    # startup, then daily. Lightweight asyncio loop — no extra scheduler dependency.
    await asyncio.to_thread(_materialize_leave_safe)

    async def _daily_refresh():
        while True:
            await asyncio.sleep(86400)
            await asyncio.to_thread(_materialize_leave_safe)

    # Auto-email payslips: wake at EMAIL_PAYSLIP_HOUR each day; act only on
    # EMAIL_PAYSLIP_DAY. No extra scheduler dependency (mirrors the leave loop).
    async def _payslip_email_scheduler():
        while True:
            now = datetime.now()
            nxt = now.replace(hour=settings.EMAIL_PAYSLIP_HOUR, minute=0, second=0, microsecond=0)
            if nxt <= now:
                nxt += timedelta(days=1)
            await asyncio.sleep((nxt - now).total_seconds())
            if datetime.now().day == settings.EMAIL_PAYSLIP_DAY:
                await asyncio.to_thread(_auto_email_payslips_safe)

    tasks = [
        asyncio.create_task(_daily_refresh()),
        asyncio.create_task(_payslip_email_scheduler()),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(
    title="Udyogi HRMS",
    version="1.0.0",
    description="Multi-entity HRMS + Payroll platform for Udyogi Group",
    lifespan=lifespan,
)

_cors_origins = ["*"] if settings.ENVIRONMENT == "development" else []

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(employees_router, prefix="/api/employees", tags=["employees"])
app.include_router(payslip_router, prefix="/api/payslip", tags=["payslip"])
app.include_router(payroll_router, prefix="/api/payroll", tags=["payroll"])
app.include_router(attendance_router, prefix="/api/attendance", tags=["attendance"])
app.include_router(iclock_router, prefix="/iclock", tags=["biometric-device"])
app.include_router(biometric_router, prefix="/api/biometric", tags=["biometric"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
app.include_router(leave_router, prefix="/api/leave", tags=["leave"])
app.include_router(locations_router, prefix="/api/locations", tags=["locations"])
app.include_router(loans_router, prefix="/api/loans", tags=["loans"])
app.include_router(meta_router, prefix="/api/meta", tags=["meta"])


@app.get("/health")
@app.get("/api/health")
def health_check():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        db_status = "unreachable"
    finally:
        db.close()
    return {"status": "ok", "db": db_status}
