from pydantic import BaseModel


class LoginRequest(BaseModel):
    emp_code: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    emp_code: str
    role: str
    entity_id: str
    name: str
    is_first_login: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str
