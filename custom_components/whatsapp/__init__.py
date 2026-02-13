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

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.typing import ConfigType
from homeassistant.components import persistent_notification

from .const import DOMAIN, CONF_HOST, DEFAULT_HOST, EVENT_MESSAGE_RECEIVED
from .client import WhatsAppBridge

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = []

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
        message = call.data.get("message")
        media_url = call.data.get("media_url")
        media_path = call.data.get("media_path")
        
        media = await get_media_data(hass, media_url, media_path)
        
        await bridge.send_message(number, message, group, media)

    hass.services.async_register(DOMAIN, "send_message", handle_send_message)

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

    return True



async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    bridge = hass.data[DOMAIN].pop(entry.entry_id)
    await bridge.stop()
    return True
