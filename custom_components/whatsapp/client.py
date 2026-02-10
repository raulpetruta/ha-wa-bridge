"""WhatsApp Bridge Client for Home Assistant."""
import asyncio
import json
import logging
from typing import Callable

import aiohttp

_LOGGER = logging.getLogger(__name__)


class WhatsAppBridge:
    """WhatsApp Bridge client."""

    def __init__(self, hass, host: str):
        """Initialize the bridge client."""
        self.hass = hass
        self.host = host
        self.ws = None
        self.session = None
        self.callback = None
        self._running = False
        self._pending_groups_request = None

    async def start(self, callback: Callable):
        """Start the WebSocket connection."""
        self.callback = callback
        self._running = True
        self.session = aiohttp.ClientSession()

        while self._running:
            try:
                _LOGGER.info("Connecting to WhatsApp bridge at %s", self.host)
                async with self.session.ws_connect(self.host) as ws:
                    self.ws = ws
                    _LOGGER.info("Connected to WhatsApp bridge")

                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            
                            # Handle groups_list response separately
                            if data.get('type') == 'groups_list':
                                if self._pending_groups_request:
                                    self._pending_groups_request.set_result(data.get('data', []))
                                    self._pending_groups_request = None
                            elif self.callback:
                                await self.callback(data)
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            _LOGGER.error("WebSocket error")
                            break

            except Exception as e:
                _LOGGER.error("WebSocket connection error: %s", e)
                if self._running:
                    await asyncio.sleep(5)
            finally:
                self.ws = None

    async def stop(self):
        """Stop the WebSocket connection."""
        self._running = False
        if self.ws:
            await self.ws.close()
        if self.session:
            await self.session.close()

    async def send_message(self, number: str, message: str):
        """Send a message to a WhatsApp number."""
        if not self.ws:
            _LOGGER.error("WebSocket not connected")
            return

        payload = {
            "type": "send_message",
            "number": number,
            "message": message
        }

        await self.ws.send_json(payload)
        _LOGGER.info("Sent message to %s", number)

    async def send_group_message(self, group_id: str, message: str):
        """Send a message to a WhatsApp group."""
        if not self.ws:
            _LOGGER.error("WebSocket not connected")
            return

        payload = {
            "type": "send_group_message",
            "group_id": group_id,
            "message": message
        }

        await self.ws.send_json(payload)
        _LOGGER.info("Sent message to group %s", group_id)

    async def get_groups(self):
        """Get list of all WhatsApp groups."""
        if not self.ws:
            _LOGGER.error("WebSocket not connected")
            return []

        # Create a future to wait for the response
        self._pending_groups_request = asyncio.Future()

        payload = {
            "type": "get_groups"
        }

        await self.ws.send_json(payload)
        _LOGGER.info("Requesting groups list")

        try:
            # Wait for response with timeout
            groups = await asyncio.wait_for(self._pending_groups_request, timeout=10.0)
            return groups
        except asyncio.TimeoutError:
            _LOGGER.error("Timeout waiting for groups list")
            self._pending_groups_request = None
            return []
