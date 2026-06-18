import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.employee import (
    AttendanceDaily, AuditLog, BiometricMapping, Employee, Location,
    StatutoryConfig, User,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slug(name: str) -> str:
    """Slug a location name: uppercase, strip parens, non-alnum -> '-', collapse."""
    s = (name or "").upper().replace("(", " ").replace(")", " ")
    s = re.sub(r"[^A-Z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")


def _actor_entity(db: Session, user: User) -> Optional[str]:
    """entity_id of the current user, or None for super_admin (unscoped)."""
    if user.role == "super_admin":
        return None
    return db.query(Employee.entity_id).filter(Employee.emp_code == user.emp_code).scalar()


def _valid_pt_codes(db: Session) -> set[str]:
    codes = {r[0] for r in db.query(StatutoryConfig.state_code).distinct().all()}
    codes.add("NIL")
    return codes


def _ref_count(db: Session, loc_id: str) -> int:
    e = db.query(Employee).filter(Employee.location_id == loc_id).count()
    a = db.query(AttendanceDaily).filter(AttendanceDaily.location_id == loc_id).count()
    b = db.query(BiometricMapping).filter(BiometricMapping.location_id == loc_id).count()
    return e + a + b


def _serialize(loc: Location) -> dict:
    return {
        "id":            loc.id,
        "name":          loc.name,
        "gstn":          loc.gstn,
        "city":          loc.city,
        "state":         loc.state,
        "pt_state_code": loc.pt_state_code,
        "entity_id":     loc.entity_id,
        "status":        loc.status,
        "phone":         loc.phone,
    }


def _audit(db: Session, user: User, action: str, loc_id: str,
           old: Optional[dict] = None, new: Optional[dict] = None,
           ip: Optional[str] = None) -> None:
    db.add(AuditLog(
        user_code=user.emp_code, action=action, table_name="locations",
        record_id=loc_id, old_values=old, new_values=new, ip_address=ip,
    ))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class LocationCreate(BaseModel):
    name: str
    gstn: Optional[str] = None
    city: Optional[str] = ""
    state: Optional[str] = ""
    pt_state_code: str = "NIL"
    entity_id: Optional[str] = None
    phone: Optional[str] = None


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    gstn: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pt_state_code: Optional[str] = None
    entity_id: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
def list_locations(
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """All locations. entity_admin sees own-entity + NULL-entity rows only."""
    q = db.query(Location)
    scope = _actor_entity(db, current_user)
    if scope is not None:
        q = q.filter((Location.entity_id == scope) | (Location.entity_id.is_(None)))
    rows = q.order_by(Location.name).all()
    return {"locations": [_serialize(l) for l in rows]}


@router.get("/active")
def list_active_locations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """(id, name) of active locations — feeds the employee add/edit dropdown."""
    q = db.query(Location).filter(Location.status == "active")
    scope = _actor_entity(db, current_user)
    if scope is not None:
        q = q.filter((Location.entity_id == scope) | (Location.entity_id.is_(None)))
    rows = q.order_by(Location.name).all()
    return {"locations": [{"id": l.id, "name": l.name} for l in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_location(
    body: LocationCreate,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    loc_id = _slug(body.name)
    if not loc_id:
        raise HTTPException(status_code=400, detail="Name must contain letters or digits")
    if db.get(Location, loc_id):
        raise HTTPException(status_code=400, detail=f"Location id '{loc_id}' already exists (name collides)")
    if body.pt_state_code not in _valid_pt_codes(db):
        raise HTTPException(status_code=400, detail=f"pt_state_code '{body.pt_state_code}' has no statutory_config slabs")

    scope = _actor_entity(db, current_user)
    if scope is not None and body.entity_id and body.entity_id != scope:
        raise HTTPException(status_code=403, detail="Cannot create a location for another entity")

    loc = Location(
        id=loc_id, name=body.name, city=body.city or "", state=body.state or "",
        pt_state_code=body.pt_state_code, entity_id=body.entity_id or None,
        gstn=body.gstn, phone=body.phone, status="active",
    )
    db.add(loc)
    ip = req.client.host if req.client else None
    _audit(db, current_user, "LOCATION_CREATE", loc_id, new=_serialize(loc), ip=ip)
    db.commit()
    db.refresh(loc)
    return _serialize(loc)


@router.put("/{loc_id}")
async def update_location(
    loc_id: str,
    request: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    raw = await request.json()
    if "id" in raw and raw["id"] != loc_id:
        raise HTTPException(status_code=400, detail="Location id is immutable")
    body = LocationUpdate.model_validate(raw)

    loc = db.get(Location, loc_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    scope = _actor_entity(db, current_user)
    if scope is not None and loc.entity_id is not None and loc.entity_id != scope:
        raise HTTPException(status_code=403, detail="Access denied for this location")

    if body.pt_state_code is not None and body.pt_state_code not in _valid_pt_codes(db):
        raise HTTPException(status_code=400, detail=f"pt_state_code '{body.pt_state_code}' has no statutory_config slabs")
    if body.status is not None and body.status not in ("active", "inactive"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'inactive'")
    if scope is not None and body.entity_id and body.entity_id != scope:
        raise HTTPException(status_code=403, detail="Cannot move a location to another entity")

    old = _serialize(loc)
    data = body.model_dump(exclude_none=True)
    for field, val in data.items():
        setattr(loc, field, val)

    ip = request.client.host if request.client else None
    _audit(db, current_user, "LOCATION_UPDATE", loc_id, old=old, new=_serialize(loc), ip=ip)
    db.commit()
    db.refresh(loc)
    return _serialize(loc)


@router.delete("/{loc_id}")
def delete_location(
    loc_id: str,
    req: Request,
    hard: bool = Query(False),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    loc = db.get(Location, loc_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    scope = _actor_entity(db, current_user)
    if scope is not None and loc.entity_id is not None and loc.entity_id != scope:
        raise HTTPException(status_code=403, detail="Access denied for this location")

    refs = _ref_count(db, loc_id)
    if refs > 0:
        raise HTTPException(
            status_code=409,
            detail=f"{refs} record(s) use this location — reassign them first",
        )

    ip = req.client.host if req.client else None
    if hard:
        _audit(db, current_user, "LOCATION_DELETE", loc_id, old=_serialize(loc), ip=ip)
        db.delete(loc)
        db.commit()
        return {"message": f"Location {loc_id} deleted"}

    # Soft: deactivate
    old = _serialize(loc)
    loc.status = "inactive"
    _audit(db, current_user, "LOCATION_DEACTIVATE", loc_id, old=old, new=_serialize(loc), ip=ip)
    db.commit()
    return {"message": f"Location {loc_id} deactivated", "status": "inactive"}
