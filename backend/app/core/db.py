from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Import all models so Base is aware of every mapped table.
# This must come after Base is defined to avoid circular imports.
import app.models  # noqa: E402, F401

try:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    print("DB connected ✓")
except Exception as e:
    raise RuntimeError(f"DB connection failed: {e}") from e


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
