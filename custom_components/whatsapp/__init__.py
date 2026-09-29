"""The WhatsApp Integration integration."""
from __future__ import annotations

import asyncio
import logging

import qrcode
import io
import base64
import aiohttp
import mimetypes
import os

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_set_service_schema
from homeassistant.helpers.typing import ConfigType
from homeassistant.components import persistent_notification

from .const import (
    CONF_GROUP,
    CONF_GROUP_ID,
    CONF_HOST,
    CONF_NUMBER,
    DEFAULT_HOST,
    DOMAIN,
    EVENT_GROUPS_RECEIVED,
    EVENT_MESSAGE_RECEIVED,
    EVENT_POLL_VOTE_RECEIVED,
    NOTIFY_SERVICE_NAME,
)
from .client import WhatsAppBridge
from .notify_targets import (
    destination_from_target,
    format_notify_message,
    normalize_phone_number,
    normalize_text,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.NOTIFY]

NOTIFY_DOMAIN = "notify"
NOTIFY_CALL_SCHEMA = vol.Schema(
    {
        vol.Required("message"): cv.string,
        vol.Optional("title"): cv.string,
        vol.Optional("target"): vol.All(cv.ensure_list, [vol.Coerce(str)]),
        vol.Optional("data"): dict,
    }
)

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the WhatsApp Integration component."""
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up WhatsApp Integration from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    host = entry.data.get(CONF_HOST, DEFAULT_HOST)
    
    bridge = WhatsAppBridge(hass, host)
    hass.data[DOMAIN][entry.entry_id] = bridge

    async def bridge_event_callback(msg):
        """Handle incoming messages from the bridge."""
        if msg['type'] == 'message':
            # Fire HA Event
            payload = msg.get('data', {})
            hass.bus.async_fire(EVENT_MESSAGE_RECEIVED, payload)
        
        elif msg['type'] == 'poll_vote':
            # Fire HA Event for poll vote
            payload = msg.get('data', {})
            hass.bus.async_fire(EVENT_POLL_VOTE_RECEIVED, payload)

        elif msg['type'] == 'get_groups_response':
            # Fire HA Event with the list of groups
            groups = msg.get('data', [])
            hass.bus.async_fire(EVENT_GROUPS_RECEIVED, {"groups": groups})
        
        elif msg['type'] == 'qr':
             # Generate QR Code Image
            try:
                qr_data = msg['data']
                img = qrcode.make(qr_data)
                buffered = io.BytesIO()
                img.save(buffered, format="PNG")
                img_str = base64.b64encode(buffered.getvalue()).decode()
                
                # Create Persistent Notification
                notification_id = f"whatsapp_qr_{entry.entry_id}"
                message = (
                    f"Please scan the QR code to link your WhatsApp account.\n\n"
                    f"![QR Code](data:image/png;base64,{img_str})"
                )
                persistent_notification.async_create(
                    hass, message, "WhatsApp Authentication", notification_id
                )
            except Exception as e:
                _LOGGER.error("Failed to generate QR notification: %s", e)

        elif msg['type'] == 'status':
             status = msg.get('status')
             _LOGGER.info("Bridge Status: %s", status)
             
             if status == 'authenticated' or status == 'ready':
                 notification_id = f"whatsapp_qr_{entry.entry_id}"
                 persistent_notification.async_dismiss(hass, notification_id)

    entry.async_create_background_task(hass, bridge.start(bridge_event_callback), "whatsapp_bridge_connect")

    # Register Service
    # Register Service
    async def get_media_data(hass, media_url, media_path):
        """Helper to retrieve media data from URL or path."""
        data = None
        mimetype = None
        filename = None

        if media_url:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(media_url) as response:
                        response.raise_for_status()
                        content = await response.read()
                        data = base64.b64encode(content).decode('utf-8')
                        mimetype = response.headers.get('Content-Type') or mimetypes.guess_type(media_url)[0]
                        filename = os.path.basename(media_url)
            except Exception as e:
                _LOGGER.error("Failed to fetch media from URL %s: %s", media_url, e)
                return None

        elif media_path:
            try:
                if not hass.config.is_allowed_path(media_path):
                    _LOGGER.error("Media path %s is not allowed", media_path)
                    return None
                
                def read_file():
                    with open(media_path, "rb") as f:
                        return f.read()
                
                content = await hass.async_add_executor_job(read_file)
                data = base64.b64encode(content).decode('utf-8')
                mimetype = mimetypes.guess_type(media_path)[0]
                filename = os.path.basename(media_path)
            except Exception as e:
                _LOGGER.error("Failed to read media from path %s: %s", media_path, e)
                return None
        
        if data:
            return {
                "mimetype": mimetype or "application/octet-stream",
                "data": data,
                "filename": filename or "media"
            }
        return None

    async def handle_send_message(call: ServiceCall):
        number = call.data.get("number")
        group = call.data.get("group")
        group_id = call.data.get("group_id")
        message = call.data.get("message")
        media_url = call.data.get("media_url")
        media_path = call.data.get("media_path")

        media = await get_media_data(hass, media_url, media_path)
        mentions = call.data.get("mentions")

        await bridge.send_message(number, message, group, group_id, media, mentions)

    hass.services.async_register(DOMAIN, "send_message", handle_send_message)

    async def handle_notify(call: ServiceCall) -> None:
        """Send a message through the standard notify.whatsapp service."""
        bridges = hass.data.get(DOMAIN) or {}
        active_bridge = bridges.get(entry.entry_id) or next(iter(bridges.values()), None)
        if active_bridge is None:
            _LOGGER.error("WhatsApp bridge is not loaded")
            return

        extra = call.data.get("data") or {}
        message = format_notify_message(call.data.get("message", ""), call.data.get("title"))
        media = await get_media_data(hass, extra.get("media_url"), extra.get("media_path"))
        number = normalize_phone_number(extra.get(CONF_NUMBER))
        group = normalize_text(extra.get(CONF_GROUP)) or None
        group_id = normalize_text(extra.get(CONF_GROUP_ID)) or None
        number = number if number.isdigit() else None

        destinations: list[tuple[str | None, str | None, str | None]] = []
        if number or group or group_id:
            destinations.append((number, group, group_id))
        else:
            for item in call.data.get("target") or []:
                parsed = destination_from_target(item)
                if any(parsed):
                    destinations.append(parsed)

        if not destinations:
            _LOGGER.error(
                "notify.whatsapp requires a target, or data.number, data.group, or data.group_id"
            )
            return

        for dest_number, dest_group, dest_group_id in destinations:
            await active_bridge.send_message(
                dest_number, message, dest_group, dest_group_id, media
            )

    hass.services.async_register(
        NOTIFY_DOMAIN,
        NOTIFY_SERVICE_NAME,
        handle_notify,
        schema=NOTIFY_CALL_SCHEMA,
    )
    async_set_service_schema(
        hass,
        NOTIFY_DOMAIN,
        NOTIFY_SERVICE_NAME,
        {
            "name": "Send WhatsApp notification",
            "description": (
                "Send a WhatsApp message. Use target for a phone number or group name, "
                "or data.number, data.group, or data.group_id."
            ),
            "fields": {
                "message": {
                    "name": "Message",
                    "description": "Notification message.",
                    "required": True,
                    "selector": {"text": None},
                },
                "title": {
                    "name": "Title",
                    "description": "Optional title, sent as the first line.",
                    "selector": {"text": None},
                },
                "target": {
                    "name": "Target",
                    "description": "Phone number (country code, no +) or group name. A list sends to each.",
                    "selector": {"text": {"multiple": True}},
                    "example": "40741234567",
                },
                "data": {
                    "name": "Data",
                    "description": "Optional number, group, group_id, media_url, or media_path.",
                    "selector": {"object": None},
                    "example": '{"group_id": "120363012345678901"}',
                },
            },
        },
    )

    async def handle_send_broadcast(call: ServiceCall):
        targets = call.data.get("targets", [])
        message = call.data.get("message")
        media_url = call.data.get("media_url")
        media_path = call.data.get("media_path")
        
        # Ensure targets is a list
        if not isinstance(targets, list):
            _LOGGER.error("Targets must be a list")
            return

        media = await get_media_data(hass, media_url, media_path)

        await bridge.send_broadcast(targets, message, media)

    hass.services.async_register(DOMAIN, "send_broadcast", handle_send_broadcast)

    async def handle_send_poll(call: ServiceCall):
        number = call.data.get("number")
        group_name = call.data.get("group")
        group_id = call.data.get("group_id")
        message = call.data.get("message")
        options = call.data.get("options")
        allow_multiple_answers = call.data.get("allow_multiple_answers", False)

        # Ensure options is a list
        if not isinstance(options, list):
             _LOGGER.error("Options must be a list")
             return

        await bridge.send_poll(number, group_name, message, options, allow_multiple_answers, group_id)

    hass.services.async_register(DOMAIN, "send_poll", handle_send_poll)

    async def handle_send_event(call: ServiceCall):
        number = call.data.get("number")
        group = call.data.get("group")
        group_id = call.data.get("group_id")
        name = call.data.get("name")
        description = call.data.get("description")
        location = call.data.get("location")
        start_time = call.data.get("start_time")
        end_time = call.data.get("end_time")
        call_type = call.data.get("call_type")

        await bridge.send_event(number, group, group_id, name, description, location, start_time, end_time, call_type)

    hass.services.async_register(DOMAIN, "send_event", handle_send_event)

    async def handle_get_groups(call: ServiceCall):
        await bridge.get_groups()

    hass.services.async_register(DOMAIN, "get_groups", handle_get_groups)

    async def handle_set_group_subject(call: ServiceCall):
        group_id = call.data.get("group_id")
        subject = call.data.get("subject")

        if not group_id or not subject:
            _LOGGER.error("group_id and subject are required for set_group_subject")
            return

        await bridge.set_group_subject(group_id, subject)

    hass.services.async_register(DOMAIN, "set_group_subject", handle_set_group_subject)

    async def handle_set_group_picture(call: ServiceCall):
        group_id = call.data.get("group_id")
        media_url = call.data.get("media_url")
        media_path = call.data.get("media_path")

        if not group_id:
            _LOGGER.error("group_id is required for set_group_picture")
            return

        media = await get_media_data(hass, media_url, media_path)
        if not media:
            _LOGGER.error("No valid media provided for set_group_picture")
            return

        await bridge.set_group_picture(group_id, media)

    hass.services.async_register(DOMAIN, "set_group_picture", handle_set_group_picture)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True



async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unload_ok:
        return False

    bridge = hass.data[DOMAIN].pop(entry.entry_id)
    await bridge.stop()

    if not hass.data[DOMAIN] and hass.services.has_service(NOTIFY_DOMAIN, NOTIFY_SERVICE_NAME):
        hass.services.async_remove(NOTIFY_DOMAIN, NOTIFY_SERVICE_NAME)

    return True
