import asyncio
import json
import logging
import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)

class WhatsAppBridge:
    def __init__(self, hass: HomeAssistant, host: str, token: str):
        self.hass = hass
        self.host = host
        self.token = token
        self._session = None
        self._ws = None
        self._running = False
        self.connection_status = "disconnected"

    @property
    def _auth_headers(self) -> dict[str, str]:
        """Return the handshake headers proving the shared secret.

        The token is never logged or included in error messages.
        """
        return {"Authorization": f"Bearer {self.token}"}

    async def start(self, event_callback=None):
        self._running = True
        
        while self._running:
            try:
                if not self._session:
                    self._session = async_get_clientsession(self.hass)

                _LOGGER.info("Connecting to WhatsApp Bridge at %s", self.host)
                async with self._session.ws_connect(
                    self.host, headers=self._auth_headers
                ) as ws:
                    self._ws = ws
                    self.connection_status = "connected"
                    _LOGGER.info("Connected to WhatsApp Bridge")
                    
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if event_callback:
                                await event_callback(data)
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            _LOGGER.error("WhatsApp Bridge connection error: %s", ws.exception())
                            break
            except aiohttp.WSServerHandshakeError as err:
                if err.status in (401, 403):
                    # Bad shared secret: retrying will never succeed. Stop and let
                    # the config entry (re)authentication handle it.
                    self.connection_status = "auth_failed"
                    self._running = False
                    _LOGGER.error(
                        "WhatsApp Bridge rejected the API token (HTTP %s). "
                        "Re-authenticate the integration with a valid token.",
                        err.status,
                    )
                    return
                _LOGGER.error("Error connecting to WhatsApp Bridge: %s", err)
                self.connection_status = "error"
            except Exception as e:
                 _LOGGER.error("Error connecting to WhatsApp Bridge: %s", e)
                 self.connection_status = "error"
            
            if self._running:
                self.connection_status = "reconnecting"
                _LOGGER.info("Reconnecting in 5 seconds...")
                await asyncio.sleep(5)

    async def stop(self):
        self._running = False
        if self._ws:
            await self._ws.close()

    async def send_message(self, number: str | None, message: str, group_name: str | None = None, group_id: str | None = None, media: dict | None = None, mentions: list | None = None):
        """Send a message via the bridge."""
        if not self._ws or self._ws.closed:
            _LOGGER.warning("Bridge not connected, cannot send message")
            return

        payload = {
            "type": "send_message",
            "message": message
        }

        if number:
            payload["number"] = number

        if group_name:
            payload["group_name"] = group_name

        if group_id:
            payload["group_id"] = group_id

        if media:
            payload["media"] = media

        if mentions:
            payload["mentions"] = mentions

        if not number and not group_name and not group_id:
             _LOGGER.error("Neither number, group_name, nor group_id provided")
             return

        await self._ws.send_json(payload)

    async def send_broadcast(self, targets: list[str], message: str, media: dict | None = None):
        """Send a broadcast message via the bridge."""
        if not self._ws or self._ws.closed:
            _LOGGER.warning("Bridge not connected, cannot send broadcast")
            return

        payload = {
            "type": "broadcast",
            "targets": targets,
            "message": message
        }
        
        if media:
            payload["media"] = media
        
        await self._ws.send_json(payload)

    async def send_poll(self, number: str | None, group_name: str | None, message: str, options: list[str], allow_multiple_answers: bool, group_id: str | None = None):
        """Send a poll via the bridge."""
        if not self._ws or self._ws.closed:
            _LOGGER.warning("Bridge not connected, cannot send poll")
            return

        payload = {
            "type": "send_poll",
            "message": message,
            "options": options,
            "allow_multiple_answers": allow_multiple_answers
        }

        if number:
            payload["number"] = number

        if group_name:
            payload["group_name"] = group_name

        if group_id:
            payload["group_id"] = group_id

        if not number and not group_name and not group_id:
             _LOGGER.error("Neither number, group_name, nor group_id provided for poll")
             return

        await self._ws.send_json(payload)

    async def send_event(self, number: str | None, group_name: str | None, group_id: str | None, name: str, description: str | None = None, location: str | None = None, start_time: str = None, end_time: str | None = None, call_type: str | None = None):
        """Send an event via the bridge."""
        if not self._ws or self._ws.closed:
            _LOGGER.warning("Bridge not connected, cannot send event")
            return

        payload = {
            "type": "send_event",
            "name": name,
            "start_time": start_time,
        }

        if number:
            payload["number"] = number
        if group_name:
            payload["group_name"] = group_name
        if group_id:
            payload["group_id"] = group_id
        if description:
            payload["description"] = description
        if location:
            payload["location"] = location
        if end_time:
            payload["end_time"] = end_time
        if call_type:
            payload["call_type"] = call_type

        if not number and not group_name and not group_id:
            _LOGGER.error("Neither number, group_name, nor group_id provided for event")
            return

        await self._ws.send_json(payload)

    async def get_groups(self):
        """Request the list of groups from the bridge."""
        if not self._ws or self._ws.closed:
            _LOGGER.warning("Bridge not connected, cannot get groups")
            return

        await self._ws.send_json({"type": "get_groups"})

    async def set_group_subject(self, group_id: str, subject: str):
        """Set a group's subject (name) via the bridge."""
        if not self._ws or self._ws.closed:
            _LOGGER.warning("Bridge not connected, cannot set group subject")
            return

        await self._ws.send_json({
            "type": "set_group_subject",
            "group_id": group_id,
            "subject": subject
        })

    async def set_group_picture(self, group_id: str, media: dict):
        """Set a group's picture via the bridge."""
        if not self._ws or self._ws.closed:
            _LOGGER.warning("Bridge not connected, cannot set group picture")
            return

        await self._ws.send_json({
            "type": "set_group_picture",
            "group_id": group_id,
            "media": media
        })
