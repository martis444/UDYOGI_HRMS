from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ENCRYPTION_KEY: str
    ENVIRONMENT: str = "development"
    UPLOAD_DIR: str = "uploads"

    # Payroll proration (Session 15.1): pay is on a fixed /30-day basis.
    # payable_factor = (PER_DAY_DIVISOR - LOP_days) / PER_DAY_DIVISOR.
    # CYCLE_CUTOFF_DAY is the salary-distribution cutoff (kept for cycle logic).
    PER_DAY_DIVISOR: int = 30
    CYCLE_CUTOFF_DAY: int = 26

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
