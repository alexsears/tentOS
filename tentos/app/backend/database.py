"""Database models and utilities."""
import asyncio
from datetime import datetime, timezone
from typing import AsyncGenerator
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey, Index
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship

from config import settings


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""
    pass


class Event(Base):
    """Event log entry."""
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tent_id = Column(String(64), nullable=False, index=True)
    event_type = Column(String(32), nullable=False, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    notes = Column(Text, nullable=True)
    user = Column(String(64), nullable=True)
    data = Column(Text, nullable=True)  # JSON string for extra data

    __table_args__ = (
        Index("ix_events_tent_time", "tent_id", "timestamp"),
    )


class Alert(Base):
    """Active alert."""
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tent_id = Column(String(64), nullable=False, index=True)
    alert_type = Column(String(32), nullable=False)
    severity = Column(String(16), default="warning")  # info, warning, critical
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    acknowledged_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    acknowledged_by = Column(String(64), nullable=True)


class Override(Base):
    """Manual override for actuators."""
    __tablename__ = "overrides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tent_id = Column(String(64), nullable=False, index=True)
    entity_id = Column(String(128), nullable=False)
    override_state = Column(String(16), nullable=False)  # on, off, auto
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime, nullable=True)
    created_by = Column(String(64), nullable=True)


class MaintenanceReminder(Base):
    """Maintenance reminder/schedule."""
    __tablename__ = "maintenance_reminders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tent_id = Column(String(64), nullable=False, index=True)
    reminder_type = Column(String(32), nullable=False)  # filter_change, reservoir_refill, cleaning
    interval_days = Column(Integer, default=30)
    last_completed = Column(DateTime, nullable=True)
    next_due = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)


class SensorHistory(Base):
    """Local sensor history for quick access."""
    __tablename__ = "sensor_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tent_id = Column(String(64), nullable=False, index=True)
    sensor_type = Column(String(32), nullable=False)
    value = Column(Float, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    __table_args__ = (
        Index("ix_sensor_history_tent_sensor_time", "tent_id", "sensor_type", "timestamp"),
    )


class ChatMessage(Base):
    """Chat message for developer chat room."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), nullable=False, index=True)
    ha_user_id = Column(String(64), nullable=True)  # Hidden - for moderation
    ha_user_name = Column(String(128), nullable=True)  # Hidden - for moderation
    display_name = Column(String(32), nullable=False)  # Public display
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    is_developer = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)


class ChatUser(Base):
    """Chat user profile linking session to nickname."""
    __tablename__ = "chat_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), nullable=False, unique=True, index=True)
    ha_user_id = Column(String(64), nullable=True)
    ha_user_name = Column(String(128), nullable=True)
    nickname = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_seen = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    is_banned = Column(Boolean, default=False)


class TelemetrySettings(Base):
    """Telemetry opt-in settings."""
    __tablename__ = "telemetry_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    install_id = Column(String(64), nullable=False, unique=True)  # Anonymous unique ID
    opted_in = Column(Boolean, default=False)
    first_seen = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_ping = Column(DateTime, nullable=True)
    version = Column(String(16), nullable=True)
    arch = Column(String(16), nullable=True)


# Database engine and session
engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.db_path}",
    echo=False,
    future=True
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
