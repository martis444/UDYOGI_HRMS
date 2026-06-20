import asyncio
import contextlib
from datetime import date

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


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI):
    # Keep leave balances fresh even with zero user activity (15.7): once at
    # startup, then daily. Lightweight asyncio loop — no extra scheduler dependency.
    await asyncio.to_thread(_materialize_leave_safe)

    async def _daily_refresh():
        while True:
            await asyncio.sleep(86400)
            await asyncio.to_thread(_materialize_leave_safe)

    task = asyncio.create_task(_daily_refresh())
    try:
        yield
    finally:
        task.cancel()
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
