from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.employee import StatutoryConfig


def get_pt_amount(
    gross: float,
    state_code: str,
    gender: str,
    month: int,
    db: Session,
) -> float:
    """
    Resolve Professional Tax from statutory_config.
    Prefers gender-specific row over 'all'. Returns 0.0 if no slab found.
    """
    today = date.today()

    row = (
        db.query(StatutoryConfig)
        .filter(
            StatutoryConfig.state_code == state_code,
            StatutoryConfig.gender.in_([gender, "all"]),
            StatutoryConfig.gross_from <= gross,
            StatutoryConfig.gross_to >= gross,
            StatutoryConfig.effective_from <= today,
            or_(
                StatutoryConfig.effective_to.is_(None),
                StatutoryConfig.effective_to >= today,
            ),
        )
        .order_by(StatutoryConfig.gender.desc())  # specific gender before 'all'
        .limit(1)
        .first()
    )

    if row is None:
        return 0.0

    if month == 2 and row.feb_override is not None:
        return float(row.feb_override)

    return float(row.monthly_amount)
