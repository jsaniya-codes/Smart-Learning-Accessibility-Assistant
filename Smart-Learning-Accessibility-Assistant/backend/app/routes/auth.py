"""User registration, login, logout, and profile endpoints."""

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    get_current_user,
    register_user,
    serialize_user,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


class RegisterRequest(BaseModel):
    fullName: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_endpoint(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Create a unique user account and return a JWT access token."""
    user = register_user(
        db=db,
        full_name=payload.fullName,
        email=str(payload.email),
        password=payload.password,
    )
    token = create_access_token(user.id)
    return {
        "accessToken": token,
        "tokenType": "bearer",
        "user": serialize_user(user),
    }


@router.post("/login")
async def login_endpoint(payload: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate an existing user and issue a JWT access token."""
    user = authenticate_user(
        db=db,
        email=str(payload.email),
        password=payload.password,
    )
    token = create_access_token(user.id)
    return {
        "accessToken": token,
        "tokenType": "bearer",
        "user": serialize_user(user),
    }


@router.post("/logout")
async def logout_endpoint(_current_user: User = Depends(get_current_user)):
    """Acknowledge client sign-out cleanly."""
    return {"ok": True, "message": "Signed out successfully."}


@router.get("/me")
async def get_me_endpoint(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    return {"user": serialize_user(current_user)}
