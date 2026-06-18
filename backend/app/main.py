from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.db import SessionLocal
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

app = FastAPI(
    title="Udyogi HRMS",
    version="1.0.0",
    description="Multi-entity HRMS + Payroll platform for Udyogi Group",
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
