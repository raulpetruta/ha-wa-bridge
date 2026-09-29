"""Constants for the WhatsApp Integration integration."""

DOMAIN = "whatsapp"
CONF_HOST = "host"
CONF_PORT = "port"

DEFAULT_HOST = "ws://localhost:3000"

CONF_TARGETS = "targets"
CONF_TARGET_ID = "id"
CONF_TARGET_NAME = "name"
CONF_NUMBER = "number"
CONF_GROUP = "group"
CONF_GROUP_ID = "group_id"

# Registered on the notify domain as notify.whatsapp
NOTIFY_SERVICE_NAME = "whatsapp"

EVENT_MESSAGE_RECEIVED = "whatsapp_message_received"
EVENT_POLL_VOTE_RECEIVED = "whatsapp_poll_vote_received"
EVENT_GROUPS_RECEIVED = "whatsapp_groups_received"
