from typing import Optional

from pydantic import BaseModel


class VisibilidadBody(BaseModel):
    report_visible: bool


class ReportUpdateBody(BaseModel):
    report_text: str


class AnnotationCreate(BaseModel):
    is_correct: bool
    final_label: Optional[str] = None
    final_category_id: Optional[int] = None
    bbox: Optional[dict] = None
    notes: Optional[str] = None


class AdminUserCreate(BaseModel):
    full_name: str
    email: str
    password: str
    role: str
