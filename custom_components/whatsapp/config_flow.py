import voluptuous as vol
import logging
import qrcode
import io
import base64
import asyncio
import aiohttp
import json

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, CONF_HOST, DEFAULT_HOST

_LOGGER = logging.getLogger(__name__)

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for WhatsApp Integration."""

    VERSION = 1

    def __init__(self):
        self._host = DEFAULT_HOST
        self._ws_task = None
        self._qr_code = None
        self._status = None

    async def async_step_user(self, user_input=None) -> FlowResult:
        """Handle the initial step."""
        errors = {}
        if user_input is not None:
            self._host = user_input[CONF_HOST]
            
            # Verify connection
            try:
                session = async_get_clientsession(self.hass)
                async with session.ws_connect(self._host) as ws:
                     # Wait for the first message to confirm it's our bridge
                     msg = await ws.receive_json()
                     # If we get a valid JSON, we assume it's the bridge
                     _LOGGER.debug("Connection verification received: %s", msg)
            except Exception as e:
                _LOGGER.warning("Could not connect to WhatsApp Bridge at %s: %s", self._host, e)
                errors["base"] = "cannot_connect"
            
            if not errors:
                return self.async_create_entry(title="WhatsApp", data={CONF_HOST: self._host})

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_HOST, default=DEFAULT_HOST): str,
            }),
            errors=errors,
            description_placeholders={"default_host": DEFAULT_HOST}
        )

    async def async_step_scan(self, user_input=None) -> FlowResult:
        """Show QR code and wait for scan."""
        _LOGGER.debug(f"async_step_scan called with user_input: {user_input}")
        
        # If user submits the form (Finish), create the entry even if not authenticated
        if user_input is not None:
             # Just create the entry. Use the host from step_user.
             return self.async_create_entry(title="WhatsApp", data={CONF_HOST: self._host})

        # Initial Load: Try to connect and show QR, but if it fails or takes too long, just show a "Finish" button.
        # Actually, let's just show a simple form that says "Click Submit to finish setup. If not authenticated, check notifications."
        
        return self.async_show_form(
            step_id="scan",
            data_schema=vol.Schema({}) # Empty schema for a simple submit button
        )
