import voluptuous as vol
from homeassistant.const import CONF_PLATFORM, CONF_EVENT
from homeassistant.core import HomeAssistant, CALLBACK_TYPE
from homeassistant.helpers import config_validation as cv, trigger
from homeassistant.helpers.typing import ConfigType

from .const import EVENT_MESSAGE_RECEIVED

TRIGGER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_PLATFORM): "whatsapp",
        vol.Optional("from_number"): cv.string,
        vol.Optional("from_group"): cv.string,
        vol.Optional("contains_text"): cv.string,
    }
)

async def async_attach_trigger(
    hass: HomeAssistant,
    config: ConfigType,
    action: trigger.TriggerActionType,
    automation_info: trigger.TriggerInfo,
) -> CALLBACK_TYPE:
    """Attach a trigger."""
    from_number = config.get("from_number")
    from_group = config.get("from_group")
    contains_text = config.get("contains_text")

    async def event_listener(event):
        """Handle the event."""
        data = event.data
        sender = data.get("from")
        body = data.get("body", "")
        chat_name = data.get("chatName")
        is_group = data.get("isGroup", False)

        # Check sender (from_number)
        if from_number:
            if sender != from_number and sender != f"{from_number}@c.us":
                return

        # Check group (from_group)
        if from_group:
            # We must expect isGroup to be true and chatName to match
            if not is_group:
                return
            if not chat_name or chat_name.lower() != from_group.lower():
                return

        # Check content if configured
        if contains_text:
            if contains_text.lower() not in body.lower():
                return

        await action(
            {
                "trigger": {
                    "platform": "whatsapp",
                    "event": data,
                    "from_number": sender,
                    "from_group": chat_name,
                    "description": f"WhatsApp message from {chat_name if is_group else sender}",
                }
            },
            event.context,
        )

    return hass.bus.async_listen(EVENT_MESSAGE_RECEIVED, event_listener)
