"""Notify entities for saved WhatsApp chats."""

from __future__ import annotations

import logging

from homeassistant.components.notify import NotifyEntity, NotifyEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_GROUP,
    CONF_GROUP_ID,
    CONF_NUMBER,
    CONF_TARGET_ID,
    CONF_TARGET_NAME,
    DOMAIN,
)
from .notify_targets import (
    format_notify_message,
    normalize_phone_number,
    normalize_text,
    notify_targets,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up WhatsApp notify entities from saved targets."""
    entities: dict[str, WhatsAppNotifyEntity] = {}

    async def async_sync_targets(config_entry: ConfigEntry) -> None:
        current = {
            target[CONF_TARGET_ID]: target for target in notify_targets(config_entry.options)
        }

        registry = er.async_get(hass)
        for target_id in list(entities):
            if target_id in current:
                continue
            entity = entities[target_id]
            if entity.entity_id and registry.async_get(entity.entity_id):
                registry.async_remove(entity.entity_id)
            else:
                await entity.async_remove(force_remove=True)
            del entities[target_id]

        added: list[WhatsAppNotifyEntity] = []
        for target_id, target in current.items():
            if target_id in entities:
                continue
            entity = WhatsAppNotifyEntity(config_entry, target)
            entities[target_id] = entity
            added.append(entity)

        if added:
            async_add_entities(added)

    await async_sync_targets(entry)

    async def async_options_updated(hass: HomeAssistant, updated_entry: ConfigEntry) -> None:
        """Add or remove notify entities when targets change."""
        await async_sync_targets(updated_entry)

    entry.async_on_unload(entry.add_update_listener(async_options_updated))


class WhatsAppNotifyEntity(NotifyEntity):
    """Send a WhatsApp message to one saved chat."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:whatsapp"
    _attr_should_poll = False
    _attr_supported_features = NotifyEntityFeature.TITLE

    def __init__(self, entry: ConfigEntry, target: dict) -> None:
        """Initialize the notify entity."""
        self._entry_id = entry.entry_id
        number = normalize_phone_number(target.get(CONF_NUMBER))
        self._number = number if number.isdigit() else None
        self._group = normalize_text(target.get(CONF_GROUP)) or None
        self._group_id = normalize_text(target.get(CONF_GROUP_ID)) or None
        self._attr_name = target.get(CONF_TARGET_NAME) or "WhatsApp"
        self._attr_unique_id = f"{entry.entry_id}_{target[CONF_TARGET_ID]}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title or "WhatsApp",
            manufacturer="ha-wa-bridge",
            model="WhatsApp Bridge",
        )

    async def async_send_message(self, message: str, title: str | None = None) -> None:
        """Send a message to the saved chat."""
        bridge = self.hass.data.get(DOMAIN, {}).get(self._entry_id)
        if bridge is None:
            _LOGGER.error("WhatsApp bridge is not loaded")
            return

        if not self._number and not self._group and not self._group_id:
            _LOGGER.error("WhatsApp notify target %s has no destination", self._attr_name)
            return

        await bridge.send_message(
            self._number,
            format_notify_message(message, title),
            self._group,
            self._group_id,
        )
