import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.dependencies import require_role
from app.models.employee import AttendanceRaw, AuditLog, BiometricMapping, Employee, User

logger = logging.getLogger(__name__)

iclock_router = APIRouter()
biometric_router = APIRouter()

_STATUS_TO_PUNCH = {0: "IN", 1: "OUT", 4: "OTIN", 5: "OTOUT"}


# ---------------------------------------------------------------------------
# ADMS protocol endpoints — no auth, device-facing
# ---------------------------------------------------------------------------

@iclock_router.get("/cdata", response_class=PlainTextResponse)
def device_handshake(SN: str = Query(...)):
    logger.info("Biometric heartbeat: device=%s", SN)
    return "OK\nATTLOG STAMP=0\n"


@iclock_router.post("/cdata", response_class=PlainTextResponse)
async def receive_punches(
    request: Request,
    SN: str = Query(...),
    table: str = Query(default=""),
    db: Session = Depends(get_db),
):
    if table.upper() != "ATTLOG":
        return "OK\n"

    body = await request.body()
    lines = body.decode("utf-8", errors="replace").splitlines()
    inserted = 0

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Strip the "ATTLOG " table-name prefix that eSSL devices prepend to each record.
        # A bare "ATTLOG" line (no fields) is a table header — skip it.
        upper = line.upper()
        if upper.startswith("ATTLOG"):
            remainder = line[6:].lstrip()
            if not remainder:
                continue           # bare header line
            line = remainder       # data follows after the prefix

        fields: dict[str, str] = {}
        for part in line.split("\t"):
            if "=" in part:
                k, _, v = part.partition("=")
                fields[k.strip().upper()] = v.strip()

        pin = fields.get("PIN")
        time_str = fields.get("TIME")
        status_str = fields.get("STATUS", "255")

        if not pin or not time_str:
            logger.warning("Malformed punch line (missing PIN/TIME): %s", line)
            continue

        try:
            punch_time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            logger.warning("Bad punch timestamp: %s", time_str)
            continue

        try:
            status_code = int(status_str)
        except ValueError:
            status_code = 255
        punch_type = _STATUS_TO_PUNCH.get(status_code, "UNK")

        mapping = (
            db.query(BiometricMapping)
            .filter(
                BiometricMapping.biometric_id == pin,
                BiometricMapping.device_sn == SN,
                BiometricMapping.is_active == True,
            )
            .first()
        )

        if mapping is None:
            logger.warning("No mapping for PIN=%s device=%s — skipped", pin, SN)
            continue

        db.add(AttendanceRaw(
            emp_code=mapping.emp_code,
            punch_time=punch_time,
            punch_type=punch_type,
            source="biometric",
            device_sn=SN,
            is_flagged=False,
            created_at=datetime.now(timezone.utc),
        ))
        inserted += 1

    db.commit()
    logger.info("device=%s inserted %d punch(es)", SN, inserted)
    return "OK\n"


# ---------------------------------------------------------------------------
# Admin / management endpoints — JWT-protected
# ---------------------------------------------------------------------------

class MappingBody(BaseModel):
    biometric_id: str
    emp_code: str
    device_sn: str
    location_id: str


@biometric_router.post("/mapping")
def upsert_mapping(
    body: MappingBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    emp = db.query(Employee).filter(Employee.emp_code == body.emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {body.emp_code} not found")

    existing = (
        db.query(BiometricMapping)
        .filter(
            BiometricMapping.biometric_id == body.biometric_id,
            BiometricMapping.device_sn == body.device_sn,
        )
        .first()
    )

    if existing:
        existing.emp_code = body.emp_code
        existing.location_id = body.location_id
        existing.is_active = True
    else:
        db.add(BiometricMapping(
            biometric_id=body.biometric_id,
            emp_code=body.emp_code,
            device_sn=body.device_sn,
            location_id=body.location_id,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        ))

    db.add(AuditLog(
        user_code=current_user.emp_code,
        action="upsert_biometric_mapping",
        table_name="biometric_mapping",
        record_id=f"{body.device_sn}:{body.biometric_id}",
        new_values={
            "biometric_id": body.biometric_id,
            "emp_code": body.emp_code,
            "device_sn": body.device_sn,
            "location_id": body.location_id,
        },
    ))
    db.commit()
    return {"status": "ok", "biometric_id": body.biometric_id, "emp_code": body.emp_code}


@biometric_router.get("/devices")
def list_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    rows = (
        db.query(
            AttendanceRaw.device_sn,
            func.max(AttendanceRaw.punch_time).label("last_seen"),
        )
        .filter(AttendanceRaw.device_sn.isnot(None))
        .group_by(AttendanceRaw.device_sn)
        .all()
    )
    return [
        {
            "device_sn": r.device_sn,
            "last_seen": r.last_seen.isoformat() if r.last_seen else None,
        }
        for r in rows
    ]
