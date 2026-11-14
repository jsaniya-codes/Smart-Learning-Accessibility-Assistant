"""Add video_recommendations table for YouTube learning video history.

Revision ID: 0002_video_recommendations
Revises: 0001_initial_schema
Create Date: 2026-11-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_video_recommendations"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "video_recommendations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=True),
        sa.Column("document_id", sa.String(length=36), nullable=True),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("topic", sa.String(length=240), nullable=False),
        sa.Column("search_query", sa.String(length=300), nullable=False),
        sa.Column("learning_level", sa.String(length=32), nullable=False),
        sa.Column("preferred_language", sa.String(length=40), nullable=False),
        sa.Column("keywords_json", sa.JSON(), nullable=True),
        sa.Column("videos_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_video_recommendations_user_id", "video_recommendations", ["user_id"], unique=False)
    op.create_index("ix_video_recommendations_conversation_id", "video_recommendations", ["conversation_id"], unique=False)
    op.create_index("ix_video_recommendations_created_at", "video_recommendations", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_video_recommendations_created_at", table_name="video_recommendations")
    op.drop_index("ix_video_recommendations_conversation_id", table_name="video_recommendations")
    op.drop_index("ix_video_recommendations_user_id", table_name="video_recommendations")
    op.drop_table("video_recommendations")
