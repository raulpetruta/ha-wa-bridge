"""The WhatsApp Integration integration."""
from __future__ import annotations

import asyncio
import logging

import qrcode
import io
import base64

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
    async def handle_send_message(call: ServiceCall):
        number = call.data.get("number")
        group = call.data.get("group")
        message = call.data.get("message")
        await bridge.send_message(number, message, group)

    hass.services.async_register(DOMAIN, "send_message", handle_send_message)

    async def handle_send_broadcast(call: ServiceCall):
        targets = call.data.get("targets", [])
        message = call.data.get("message")
        
        # Ensure targets is a list
        if not isinstance(targets, list):
            _LOGGER.error("Targets must be a list")
            return

        await bridge.send_broadcast(targets, message)

    hass.services.async_register(DOMAIN, "send_broadcast", handle_send_broadcast)

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    bridge = hass.data[DOMAIN].pop(entry.entry_id)
    await bridge.stop()
    return True
