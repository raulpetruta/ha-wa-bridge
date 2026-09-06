import voluptuous as vol
from homeassistant.const import CONF_PLATFORM, CONF_EVENT
from homeassistant.core import HomeAssistant, CALLBACK_TYPE
from homeassistant.helpers import config_validation as cv, trigger
from homeassistant.helpers.typing import ConfigType

from .const import EVENT_MESSAGE_RECEIVED

TRIGGER_SCHEMA = cv.TRIGGER_BASE_SCHEMA.extend(
    {
        vol.Required(CONF_PLATFORM): "whatsapp",
        vol.Optional("from_number"): cv.string,
        vol.Optional("from_group"): cv.string,
        vol.Optional("from_group_id"): cv.string,
        vol.Optional("contains_text"): cv.string,
        vol.Optional("equals_text"): cv.string,
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
    from_group_id = config.get("from_group_id")
    contains_text = config.get("contains_text")
    equals_text = config.get("equals_text")

    async def event_listener(event):
        """Handle the event."""
        data = event.data

        sender = data.get("from")
        body = data.get("body", "")
        chat_name = data.get("chatName")
        group_id = data.get("groupId")
        is_group = data.get("isGroup", False)

        # WhatsApp sends own messages in groups with:
        #   from: <own-lid>
        #   to: <group-id>@g.us
        #
        # In this case groupId/isGroup may not be present in the
        # Home Assistant event, so derive them from "to".
        to = data.get("to", "")

        if to and to.endswith("@g.us"):
            is_group = True

            # If groupId wasn't supplied by the bridge, derive it
            # from the WhatsApp group JID.
            if not group_id:
                group_id = to

        # Check sender (from_number)
        if from_number:
            if sender != from_number and sender != f"{from_number}@c.us":
                return

        # Check group by ID (from_group_id)
        if from_group_id:
            if not is_group:
                return

            if not group_id:
                return

            # Accept both:
            #   120363428656253626
            # and
            #   120363428656253626@g.us
            normalized_group_id = group_id.removesuffix("@g.us")
            normalized_from_group_id = from_group_id.removesuffix("@g.us")

            if normalized_group_id != normalized_from_group_id:
                return

        # Check group by name (from_group)
        if from_group:
            if not is_group:
                return

            if not chat_name or chat_name.lower() != from_group.lower():
                return

        # Check content if configured
        if contains_text:
            if contains_text.lower() not in body.lower():
                return

        if equals_text:
            if equals_text.strip().lower() != body.strip().lower():
                return

        await action(
            {
                "trigger": {
                    "platform": "whatsapp",
                    "id": config.get("id"),
                    "event": data,
                    "from_number": sender,
                    "from_group": chat_name,
                    "from_group_id": group_id,
                    "description": (
                        f"WhatsApp message from "
                        f"{chat_name if is_group else sender}"
                    ),
                }
            },
            event.context,
        )

    return hass.bus.async_listen(EVENT_MESSAGE_RECEIVED, event_listener)
