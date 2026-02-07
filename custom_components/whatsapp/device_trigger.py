import voluptuous as vol
from homeassistant.const import CONF_TYPE, CONF_PLATFORM, CONF_DOMAIN, CONF_EVENT
from homeassistant.core import HomeAssistant, CALLBACK_TYPE
from homeassistant.helpers import config_validation as cv, trigger
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, EVENT_MESSAGE_RECEIVED

TRIGGER_TYPES = {"message_received"}

TRIGGER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_PLATFORM): "device",
        vol.Required(CONF_DOMAIN): DOMAIN,
        vol.Required(CONF_TYPE): "message_received",
        vol.Optional("from_number"): str,
        vol.Optional("contains_text"): str,
    }
)

async def async_get_triggers(hass: HomeAssistant, device_id: str) -> list[dict]:
    """List device triggers for WhatsApp Integration."""
    return [
        {
            CONF_PLATFORM: "device",
            CONF_DOMAIN: DOMAIN,
            CONF_TYPE: "message_received",
            "device_id": device_id,
        }
    ]

async def async_attach_trigger(
    hass: HomeAssistant,
    config: ConfigType,
    action: trigger.TriggerActionType,
    automation_info: trigger.TriggerInfo,
) -> CALLBACK_TYPE:
    """Attach a trigger."""
    event_config = {
        trigger.CONF_PLATFORM: "event",
        trigger.CONF_EVENT_TYPE: EVENT_MESSAGE_RECEIVED,
        trigger.CONF_EVENT_DATA: {},
    }

    if "from_number" in config:
        event_config[trigger.CONF_EVENT_DATA]["from"] = config["from_number"]

    # For 'contains_text', we can't easily use basic event data matching if we want partial match.
    # We might need a custom trigger wrapper. 
    # For now, let's keep it simple: exact match on 'from', and we'll handle partial match in a wrapper if needed.
    # Or just use the event trigger with a template condition, but that's not 'device trigger'.
    
    # Actually, let's implement a manual check.
    
    async def event_listener(event):
        """Handle the event."""
        data = event.data
        
        # Check from_number
        if "from_number" in config:
            if data.get("from") != config["from_number"] and data.get("from") != f"{config['from_number']}@c.us":
                 return

        # Check contains_text
        if "contains_text" in config:
            if config["contains_text"].lower() not in data.get("body", "").lower():
                return

        await action(event.context)

    return hass.bus.async_listen(EVENT_MESSAGE_RECEIVED, event_listener)
