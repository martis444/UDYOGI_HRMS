"""
Bootstrap script — sets the initial password hash for UP000001.
Run once after DB seed: python scripts/create_superadmin.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.security import hash_password
from app.core.db import SessionLocal
from app.models.employee import User

DEFAULT_PASSWORD = "Udyogi@2026"

db = SessionLocal()
try:
    user = db.query(User).filter(User.emp_code == "UP000001").first()
    if not user:
        print("ERROR: UP000001 not found in users table. Run seed SQL first.")
        sys.exit(1)
    user.password_hash = hash_password(DEFAULT_PASSWORD)
    user.is_first_login = True
    db.commit()
    print(f"Superadmin password set. emp_code=UP000001 password={DEFAULT_PASSWORD}")
    print("is_first_login=True — user must change password on first login.")
finally:
    db.close()
