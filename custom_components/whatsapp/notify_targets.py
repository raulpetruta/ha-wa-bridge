"""Pure helpers for WhatsApp notify targets."""

from __future__ import annotations

from collections.abc import Mapping


def normalize_text(value: object | None) -> str:
    """Return a stripped string."""
    if value is None:
        return ""
    return str(value).strip()


def normalize_phone_number(value: object | None) -> str:
    """Return a WhatsApp phone number without +, spaces, or a JID suffix."""
    text = normalize_text(value)
    if text.startswith("+"):
        text = text[1:]
    text = text.replace(" ", "").replace("-", "")
    if "@" in text:
        text = text.split("@", 1)[0]
    if ":" in text:
        text = text.split(":", 1)[0]
    return text


def format_notify_message(message: str, title: str | None) -> str:
    """Combine an optional notify title with the message body."""
    body = message or ""
    heading = normalize_text(title)
    if not heading:
        return body
    if not body:
        return heading
    return f"{heading}\n{body}"


def destination_from_target(target: object) -> tuple[str | None, str | None, str | None]:
    """Map a notify target string to (number, group_name, group_id).

    Digits are phone numbers. Anything else is a group name.
    Explicit WhatsApp JIDs keep their chat type.
    """
    value = normalize_text(target)
    if not value:
        return None, None, None

    if "@" in value:
        local, domain = value.split("@", 1)
        domain = domain.lower()
        if ":" in local:
            local = local.split(":", 1)[0]
        if domain == "g.us":
            return None, None, value
        if domain in {"c.us", "s.whatsapp.net"}:
            return local, None, None

    number = normalize_phone_number(value)
    if number.isdigit():
        return number, None, None

    return None, value, None


def notify_targets(options: Mapping) -> list[dict]:
    """Return saved notify targets from a config entry options mapping."""
    raw = options.get("targets", [])
    if not isinstance(raw, list):
        return []
    return [dict(item) for item in raw if isinstance(item, dict) and item.get("id")]
