"""Developer chat API routes."""
import html
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, ChatMessage, ChatUser
from config import load_addon_config

logger = logging.getLogger(__name__)
router = APIRouter()

# Rate limiting: session_id -> last_message_time
RATE_LIMIT: dict[str, datetime] = {}
RATE_LIMIT_SECONDS = 1


def get_developer_ha_user() -> Optional[str]:
    """Get configured developer HA user from addon config."""
    config = load_addon_config()
    return config.get("developer_ha_user")


def sanitize_content(content: str) -> str:
    """Sanitize message content - strip HTML, limit length."""
    # Escape HTML entities
    content = html.escape(content)
    # Remove any remaining tags
    content = re.sub(r'<[^>]+>', '', content)
    # Limit length
    return content[:500].strip()


def generate_display_name(session_id: str, nickname: Optional[str] = None) -> str:
    """Generate display name from nickname or session ID."""
    if nickname:
        return nickname[:20]
    # Use last 4 chars of session ID
    suffix = session_id[-4:] if len(session_id) >= 4 else session_id
    return f"Anon-{suffix}"


def check_rate_limit(session_id: str) -> bool:
    """Check if session is rate limited. Returns True if allowed."""
    now = datetime.now(timezone.utc)
    last = RATE_LIMIT.get(session_id)
    if last and (now - last).total_seconds() < RATE_LIMIT_SECONDS:
        return False
    RATE_LIMIT[session_id] = now
    return True


def is_developer(ha_user_name: Optional[str]) -> bool:
    """Check if user is the developer."""
    dev_user = get_developer_ha_user()
    if dev_user and ha_user_name and ha_user_name.lower() == dev_user.lower():
        return True
    return False


class MessageCreate(BaseModel):
    """Request model for sending a message."""
    content: str = Field(..., min_length=1, max_length=500)
    session_id: str = Field(..., min_length=8, max_length=64)


class NicknameUpdate(BaseModel):
    """Request model for updating nickname."""
    nickname: str = Field(..., min_length=2, max_length=20)


class MessageResponse(BaseModel):
    """Public message response."""
    id: int
    display_name: str
    content: str
    timestamp: str
    is_developer: bool


@router.get("/messages")
async def get_messages(
    limit: int = 50,
    before: Optional[int] = None
):
    """Get chat message history."""
    async for session in get_db():
        query = select(ChatMessage).where(ChatMessage.is_deleted == False)

        if before:
            query = query.where(ChatMessage.id < before)

        query = query.order_by(desc(ChatMessage.id)).limit(limit + 1)

        result = await session.execute(query)
        messages = result.scalars().all()

        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]

        # Reverse to chronological order
        messages = list(reversed(messages))

        return {
            "messages": [
                {
                    "id": m.id,
                    "display_name": m.display_name,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat(),
                    "is_developer": m.is_developer
                }
                for m in messages
            ],
            "has_more": has_more
        }


@router.post("/messages")
async def send_message(msg: MessageCreate, request: Request):
    """Send a chat message."""
    session_id = msg.session_id

    # Rate limit check
    if not check_rate_limit(session_id):
        raise HTTPException(status_code=429, detail="Rate limited. Wait a moment.")

    # Sanitize content
    content = sanitize_content(msg.content)
    if not content:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    async for db_session in get_db():
        # Get or create user
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == session_id)
        )
        user = result.scalar_one_or_none()

        # Try to get HA user info from request headers
        ha_user_name = request.headers.get("X-Ingress-User") or request.headers.get("X-Ha-User")
        ha_user_id = request.headers.get("X-Ingress-User-Id")

        if not user:
            user = ChatUser(
                session_id=session_id,
                ha_user_id=ha_user_id,
                ha_user_name=ha_user_name
            )
            db_session.add(user)
            await db_session.commit()
            await db_session.refresh(user)
        else:
            # Update HA info if available
            if ha_user_name and not user.ha_user_name:
                user.ha_user_name = ha_user_name
            if ha_user_id and not user.ha_user_id:
                user.ha_user_id = ha_user_id
            user.last_seen = datetime.now(timezone.utc)
            await db_session.commit()

        # Check if banned
        if user.is_banned:
            raise HTTPException(status_code=403, detail="You have been banned from chat")

        # Create message
        display_name = generate_display_name(session_id, user.nickname)
        dev = is_developer(ha_user_name or user.ha_user_name)

        message = ChatMessage(
            session_id=session_id,
            ha_user_id=ha_user_id or user.ha_user_id,
            ha_user_name=ha_user_name or user.ha_user_name,
            display_name=display_name,
            content=content,
            is_developer=dev
        )
        db_session.add(message)
        await db_session.commit()
        await db_session.refresh(message)

        return {
            "id": message.id,
            "display_name": message.display_name,
            "content": message.content,
            "timestamp": message.timestamp.isoformat(),
            "is_developer": message.is_developer
        }


@router.get("/user")
async def get_user(session_id: str):
    """Get current user profile."""
    async for db_session in get_db():
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == session_id)
        )
        user = result.scalar_one_or_none()

        if not user:
            # Return default for new user
            return {
                "session_id": session_id,
                "display_name": generate_display_name(session_id),
                "nickname": None,
                "is_banned": False
            }

        return {
            "session_id": user.session_id,
            "display_name": generate_display_name(session_id, user.nickname),
            "nickname": user.nickname,
            "is_banned": user.is_banned
        }


@router.put("/user/nickname")
async def update_nickname(data: NicknameUpdate, session_id: str):
    """Update user nickname."""
    nickname = data.nickname.strip()

    # Validate nickname
    if not re.match(r'^[\w\s-]+$', nickname):
        raise HTTPException(status_code=400, detail="Nickname can only contain letters, numbers, spaces, and hyphens")

    async for db_session in get_db():
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == session_id)
        )
        user = result.scalar_one_or_none()

        if not user:
            user = ChatUser(session_id=session_id, nickname=nickname)
            db_session.add(user)
        else:
            user.nickname = nickname

        await db_session.commit()

        return {
            "success": True,
            "display_name": generate_display_name(session_id, nickname)
        }


# === Developer-only endpoints ===

@router.get("/admin/users")
async def list_users(dev_session_id: str, request: Request):
    """List all chat users with HA info (developer only)."""
    # Verify developer
    async for db_session in get_db():
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == dev_session_id)
        )
        dev_user = result.scalar_one_or_none()

        ha_user = request.headers.get("X-Ingress-User") or (dev_user.ha_user_name if dev_user else None)
        if not is_developer(ha_user):
            raise HTTPException(status_code=403, detail="Developer access required")

        # Get all users with message counts
        result = await db_session.execute(
            select(
                ChatUser,
                func.count(ChatMessage.id).label('message_count')
            )
            .outerjoin(ChatMessage, ChatUser.session_id == ChatMessage.session_id)
            .group_by(ChatUser.id)
            .order_by(desc(ChatUser.last_seen))
        )
        rows = result.all()

        return {
            "users": [
                {
                    "id": user.id,
                    "session_id": user.session_id,
                    "ha_user_id": user.ha_user_id,
                    "ha_user_name": user.ha_user_name,
                    "nickname": user.nickname,
                    "display_name": generate_display_name(user.session_id, user.nickname),
                    "message_count": count,
                    "created_at": user.created_at.isoformat(),
                    "last_seen": user.last_seen.isoformat() if user.last_seen else None,
                    "is_banned": user.is_banned
                }
                for user, count in rows
            ]
        }


@router.post("/admin/ban/{session_id}")
async def ban_user(session_id: str, dev_session_id: str, request: Request):
    """Ban a user (developer only)."""
    async for db_session in get_db():
        # Verify developer
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == dev_session_id)
        )
        dev_user = result.scalar_one_or_none()

        ha_user = request.headers.get("X-Ingress-User") or (dev_user.ha_user_name if dev_user else None)
        if not is_developer(ha_user):
            raise HTTPException(status_code=403, detail="Developer access required")

        # Find and ban user
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == session_id)
        )
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.is_banned = True
        await db_session.commit()

        return {"success": True, "message": f"User {session_id} banned"}


@router.post("/admin/unban/{session_id}")
async def unban_user(session_id: str, dev_session_id: str, request: Request):
    """Unban a user (developer only)."""
    async for db_session in get_db():
        # Verify developer
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == dev_session_id)
        )
        dev_user = result.scalar_one_or_none()

        ha_user = request.headers.get("X-Ingress-User") or (dev_user.ha_user_name if dev_user else None)
        if not is_developer(ha_user):
            raise HTTPException(status_code=403, detail="Developer access required")

        # Find and unban user
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == session_id)
        )
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.is_banned = False
        await db_session.commit()

        return {"success": True, "message": f"User {session_id} unbanned"}


@router.delete("/admin/messages/{message_id}")
async def delete_message(message_id: int, dev_session_id: str, request: Request):
    """Delete a message (developer only)."""
    async for db_session in get_db():
        # Verify developer
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == dev_session_id)
        )
        dev_user = result.scalar_one_or_none()

        ha_user = request.headers.get("X-Ingress-User") or (dev_user.ha_user_name if dev_user else None)
        if not is_developer(ha_user):
            raise HTTPException(status_code=403, detail="Developer access required")

        # Find and soft-delete message
        result = await db_session.execute(
            select(ChatMessage).where(ChatMessage.id == message_id)
        )
        message = result.scalar_one_or_none()

        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

        message.is_deleted = True
        await db_session.commit()

        return {"success": True, "message": "Message deleted"}


# WebSocket broadcast helper (called from main.py)
async def broadcast_chat_message(ws_clients: list, message: dict):
    """Broadcast a chat message to all WebSocket clients."""
    payload = json.dumps({
        "type": "chat_new_message",
        "message": message
    })

    disconnected = []
    for ws in ws_clients:
        try:
            await ws.send_text(payload)
        except Exception:
            disconnected.append(ws)

    return disconnected
