import uuid
from collections.abc import Mapping
from typing import Any

import voluptuous as vol
import logging
import asyncio
import aiohttp

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_GROUP,
    CONF_GROUP_ID,
    CONF_HOST,
    CONF_NUMBER,
    CONF_TARGET_ID,
    CONF_TARGET_NAME,
    CONF_TARGETS,
    CONF_TOKEN,
    DEFAULT_HOST,
    DOMAIN,
)
from .notify_targets import normalize_phone_number, normalize_text, notify_targets

_LOGGER = logging.getLogger(__name__)

AUTH_FAILED_STATUSES = (401, 403)


async def _async_verify_connection(
    hass: HomeAssistant, host: str, token: str
) -> str | None:
    """Verify the bridge accepts the shared secret during the handshake.

    Returns a config flow error key, or None when the connection succeeded.
    The token is only ever sent in the Authorization header, never logged.
    """
    try:
        session = async_get_clientsession(hass)
        async with asyncio.timeout(10):
            async with session.ws_connect(
                host, headers={"Authorization": f"Bearer {token}"}
            ) as ws:
                # The bridge always announces itself (status or QR) on connect.
                msg = await ws.receive_json()
                _LOGGER.debug("Connection verification received: %s", msg)
    except aiohttp.WSServerHandshakeError as err:
        if err.status in AUTH_FAILED_STATUSES:
            _LOGGER.warning("WhatsApp Bridge rejected the API token")
            return "invalid_auth"
        _LOGGER.warning("Could not connect to WhatsApp Bridge at %s: %s", host, err)
        return "cannot_connect"
    except (aiohttp.ClientError, TimeoutError, ValueError) as err:
        _LOGGER.warning("Could not connect to WhatsApp Bridge at %s: %s", host, err)
        return "cannot_connect"
    return None


def _connection_schema(host: str) -> vol.Schema:
    """Build the host + token form shared by user and reauth steps."""
    return vol.Schema(
        {
            vol.Required(CONF_HOST, default=host): str,
            vol.Required(CONF_TOKEN): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
            ),
        }
    )


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for WhatsApp Integration."""

    VERSION = 2

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Return the options flow."""
        return WhatsAppOptionsFlow()

    def __init__(self):
        self._host = DEFAULT_HOST
        self._token = ""
        self._qr_code = None
        self._status = None

    async def async_step_user(self, user_input=None) -> FlowResult:
        """Handle the initial step."""
        errors = {}
        if user_input is not None:
            self._host = user_input[CONF_HOST]
            self._token = user_input[CONF_TOKEN]
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()

            # Verify the bridge accepts the API token before creating the entry.
            error = await _async_verify_connection(self.hass, self._host, self._token)
            if error:
                errors["base"] = error
            else:
                return self.async_create_entry(
                    title="WhatsApp",
                    data={CONF_HOST: self._host, CONF_TOKEN: self._token},
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_connection_schema(self._host),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> FlowResult:
        """Start re-authentication when the bridge rejects the saved token."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None) -> FlowResult:
        """Ask for a fresh API token after the bridge rejected the old one."""
        errors = {}
        entry = self.hass.config_entries.async_get_entry(self.context["entry_id"])
        if entry is None:
            return self.async_abort(reason="reauth_failed")

        if user_input is not None:
            host = user_input[CONF_HOST]
            token = user_input[CONF_TOKEN]
            error = await _async_verify_connection(self.hass, host, token)
            if error:
                errors["base"] = error
            else:
                # Replace host and token, keeping any other entry data intact.
                return self.async_update_reload_and_abort(
                    entry,
                    data={**entry.data, CONF_HOST: host, CONF_TOKEN: token},
                    reason="reauth_successful",
                )

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=_connection_schema(
                user_input[CONF_HOST]
                if user_input is not None
                else entry.data.get(CONF_HOST, DEFAULT_HOST)
            ),
            errors=errors,
        )


class WhatsAppOptionsFlow(config_entries.OptionsFlow):
    """Manage saved chats that are exposed as notify entities."""

    async def async_step_init(self, user_input=None) -> FlowResult:
        """Offer adding or removing a notification target."""
        targets = notify_targets(self.config_entry.options)
        if not targets:
            return await self.async_step_add_target()

        return self.async_show_menu(
            step_id="init",
            menu_options=["add_target", "remove_target"],
            description_placeholders={"targets": _format_targets(targets)},
        )

    async def async_step_add_target(self, user_input=None) -> FlowResult:
        """Create a notify entity for one phone number or group."""
        errors = {}
        if user_input is not None:
            name = normalize_text(user_input.get(CONF_TARGET_NAME))
            number = normalize_phone_number(user_input.get(CONF_NUMBER))
            group = normalize_text(user_input.get(CONF_GROUP))
            group_id = normalize_text(user_input.get(CONF_GROUP_ID))
            destinations = [value for value in (number, group, group_id) if value]
            existing = notify_targets(self.config_entry.options)

            if not name:
                errors[CONF_TARGET_NAME] = "name_required"
            elif any(target.get(CONF_TARGET_NAME, "").casefold() == name.casefold() for target in existing):
                errors[CONF_TARGET_NAME] = "name_exists"
            elif number and not number.isdigit():
                errors[CONF_NUMBER] = "invalid_number"
            elif not destinations:
                errors["base"] = "missing_destination"
            elif len(destinations) > 1:
                errors["base"] = "multiple_destinations"
            else:
                existing.append(
                    {
                        CONF_TARGET_ID: uuid.uuid4().hex,
                        CONF_TARGET_NAME: name,
                        CONF_NUMBER: number,
                        CONF_GROUP: group,
                        CONF_GROUP_ID: group_id,
                    }
                )
                return self._async_save_targets(existing)

        return self.async_show_form(
            step_id="add_target",
            data_schema=_target_schema(user_input),
            errors=errors,
        )

    async def async_step_remove_target(self, user_input=None) -> FlowResult:
        """Remove a saved notification target."""
        targets = notify_targets(self.config_entry.options)
        if not targets:
            return await self.async_step_init()

        if user_input is not None:
            target_id = user_input[CONF_TARGET_ID]
            remaining = [target for target in targets if target.get(CONF_TARGET_ID) != target_id]
            return self._async_save_targets(remaining)

        return self.async_show_form(
            step_id="remove_target",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TARGET_ID): vol.In(
                        {
                            target[CONF_TARGET_ID]: target.get(CONF_TARGET_NAME, target[CONF_TARGET_ID])
                            for target in targets
                        }
                    )
                }
            ),
        )

    def _async_save_targets(self, targets: list[dict]) -> FlowResult:
        """Store targets without dropping other options."""
        options = dict(self.config_entry.options)
        options[CONF_TARGETS] = targets
        return self.async_create_entry(data=options)


def _format_targets(targets: list[dict]) -> str:
    """Summarize saved targets for the options menu."""
    if not targets:
        return "No saved targets yet."

    lines = []
    for target in targets:
        destination = (
            target.get(CONF_GROUP_ID)
            or target.get(CONF_GROUP)
            or target.get(CONF_NUMBER)
            or "no destination"
        )
        lines.append(f"- {target.get(CONF_TARGET_NAME, 'WhatsApp')}: {destination}")
    return "\n".join(lines)


def _target_schema(user_input: dict | None) -> vol.Schema:
    """Build the add-target form, keeping submitted values after an error."""
    user_input = user_input or {}
    return vol.Schema(
        {
            vol.Required(
                CONF_TARGET_NAME, default=normalize_text(user_input.get(CONF_TARGET_NAME))
            ): str,
            vol.Optional(CONF_NUMBER, default=normalize_text(user_input.get(CONF_NUMBER))): str,
            vol.Optional(CONF_GROUP, default=normalize_text(user_input.get(CONF_GROUP))): str,
            vol.Optional(
                CONF_GROUP_ID, default=normalize_text(user_input.get(CONF_GROUP_ID))
            ): str,
        }
    )
