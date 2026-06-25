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

    # Leave (Session 15.3 / 18). Annual quota per bucket. CL/SL/PL only (EL retired).
    #   - PL: granted after 1y DOJ, cumulative (carries forward), tb = years × quota.
    #   - CL/SL (Session 18): do NOT carry forward. They accrue monthly (quota/12)
    #     within the financial year, starting after confirmation_date, and reset to 0
    #     at the start of each financial year (FINANCIAL_YEAR_START_MONTH).
    ANNUAL_LEAVE: dict[str, int] = {"CL": 10, "SL": 7, "PL": 14}
    FINANCIAL_YEAR_START_MONTH: int = 4  # India FY: 1 April – 31 March

    # Late-coming penalty (Session 15.4): every N 'late' days in a pay period = 1
    # absent-equivalent, covered first by leave balance, the remainder charged as LD.
    LATE_DAYS_PER_ABSENT: int = 3

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
