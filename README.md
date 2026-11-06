> **Disclaimer**
> This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with WhatsApp or any of its subsidiaries or its affiliates. The official WhatsApp website can be found at [whatsapp.com](https://www.whatsapp.com). "WhatsApp" as well as related names, marks, emblems and images are registered trademarks of their respective owners. Also it is not guaranteed you will not be blocked by using this method. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe. For any businesses looking to integrate with WhatsApp for critical applications, we highly recommend using officially supported methods, such as Twilio's solution or other alternatives. You might also consider the [official API](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview).

# Home Assistant WhatsApp Integration

[![HACS](https://img.shields.io/badge/HACS-Default-41BDF5.svg)](https://hacs.xyz)
[![hassfest](https://github.com/raulpetruta/ha-wa-bridge/actions/workflows/hassfest.yaml/badge.svg)](https://github.com/raulpetruta/ha-wa-bridge/actions/workflows/hassfest.yaml)

A custom integration to send and receive WhatsApp messages in Home Assistant naturally. It uses a local [Baileys](https://github.com/WhiskeySockets/Baileys) bridge running in Docker, without Chromium.

## Features
- **Send Messages**: Use the `wa_bridge.send_message` service in HA.
- **Notify**: Use the standard `notify.whatsapp` service, or save a chat as a notify entity and call `notify.send_message`.
- **Group Messaging**: Send messages to WhatsApp groups by name or by group ID.
- **Mentions**: Tag people in a group message with a `mentions` list on `wa_bridge.send_message`. A bare phone number is enough. The bridge adds `@number` when it is not already in the text.
- **Group ID Support**: Target groups by their stable ID instead of name — automations won't break when a group is renamed.
- **Get Groups**: Retrieve all WhatsApp groups with their IDs using the `wa_bridge.get_groups` service.
- **Set Group Subject**: Dynamically update a group's name using the `wa_bridge.set_group_subject` service — perfect for automating group names based on schedules or sensor values.
- **Set Group Picture**: Update a group's picture using the `wa_bridge.set_group_picture` service.
- **Receive Messages**: Trigger automations when messages arrive (including WhatsApp Community channels).
- **Send Events**: Send WhatsApp calendar events with name, location, and time using the `wa_bridge.send_event` service.
- **Receive Filtering**: Disable incoming messages entirely or restrict to specific groups to save resources.
- **Easy Auth**: Scan a QR code in Home Assistant to link your account.
- **Secure by default**: The bridge requires an API token before it accepts commands, and received media is documented to live outside Home Assistant's public `/local/` folder.

## Security

The bridge can send WhatsApp messages as your linked account, read incoming messages, and change groups, so it must never be reachable without authentication.

- **The API token is required.** The bridge refuses to start until a shared secret is configured. Set it as the add-on option `api_token` (or the `API_TOKEN` environment variable for Docker), then enter the same value in the integration's **API token** field. Generate a strong value with:

  ```bash
  openssl rand -hex 32
  ```

- The integration authenticates with the WebSocket `Authorization: Bearer <token>` header. The bridge rejects unauthenticated connections with HTTP 401. The `?token=` query parameter exists as a fallback for manual testing only.
- Never log or share the token. Do not expose port `3000` to the internet: keep the bridge on your local network (or reach it through a VPN) and restrict the port with your firewall or container network if possible.
- **Received media must not live under `/config/www`.** Everything below `/config/www` is served **unauthenticated** at `/local/`. Point `media_download_path` at a location Home Assistant does not serve, such as `/media/whatsapp`.

## Usage

### Sending a Message
You can send messages to any number using the service:

```yaml
service: wa_bridge.send_message
data:
  number: "40741234567" # Country code + Number (no "+" symbol) 
  message: "Hello from Home Assistant! 🏠"
```

### Sending to a Group
You can send messages to a group by its exact name:

```yaml
service: wa_bridge.send_message
data:
  group: "Family Group" # Exact name of the group
  message: "Dinner is ready! 🍽️"
```

### Sending to a Group by ID
You can send messages to a group using its stable ID. This is recommended for automations since the ID doesn't change when the group is renamed. Use the `wa_bridge.get_groups` service to find group IDs; or check the add on logs while sending / receiving a message for a group to get the ID

```yaml
service: wa_bridge.send_message
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  message: "Dinner is ready! 🍽️"
```

### Mentioning people
`mentions` tags phone numbers in a group message. Use the country code and no `+`. A bare number, `number@c.us`, or `number@s.whatsapp.net` all work. If the message does not already contain `@number`, the bridge adds it so WhatsApp can highlight the person.

```yaml
service: wa_bridge.send_message
data:
  group_id: "120363012345678901"
  message: "hello world"
  mentions:
    - "40741234567"
```

Mentions are sent with text, photo, and video messages.

### Notify

`notify.whatsapp` sends a text message with Home Assistant's standard notify fields. `target` is a phone number (country code, no `+`) or a group name. A list sends the same message to each chat. An optional `title` is sent as the first line.

```yaml
action: notify.whatsapp
data:
  message: "Hello from Home Assistant! 🏠"
  target: "40741234567"
```

Use `data` for a group ID, or to attach a file:

```yaml
action: notify.whatsapp
data:
  message: "Dinner is ready! 🍽️"
  data:
    group_id: "120363012345678901" # OR number / group, plus optional media_url or media_path
```

Saved chats also show up as notify entities, so you can pick them in the automation editor.

1. Open **Settings → Devices & services → WhatsApp Integration → Configure**.
2. Add a notification target.
3. Name the chat and set one destination: a phone number, a group name, or a group ID.

A target named `Family` shows up as `notify.whatsapp_family`.

```yaml
action: notify.send_message
target:
  entity_id: notify.whatsapp_family
data:
  message: "Dinner is ready! 🍽️"
  title: "Home" # Optional. Sent as the first line.
```

`wa_bridge.send_message` is unchanged.

### Retrieving Group IDs
Use the `wa_bridge.get_groups` service to retrieve all your WhatsApp groups with their IDs. The results are fired as a `whatsapp_groups_received` event.

```yaml
service: wa_bridge.get_groups
```

You can listen for the result with an automation:

```yaml
trigger:
  - platform: event
    event_type: whatsapp_groups_received
action:
  - service: persistent_notification.create
    data:
      title: "WhatsApp Groups"
      message: >
        {% for group in trigger.event.data.groups %}
        - {{ group.name }}: {{ group.id }}
        {% endfor %}
```

### Setting a Group Subject (Name)
You can dynamically update a group's name using the `wa_bridge.set_group_subject` service. This is useful for automating group names based on schedules or template sensors. Requires admin permissions in the group.

```yaml
service: wa_bridge.set_group_subject
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  subject: "Weekly Meeting - Monday 7PM"
```

### Setting a Group Picture
You can update a group's picture using the `wa_bridge.set_group_picture` service. Supports both URL and local path. Requires admin permissions in the group.

#### Using a URL
```yaml
service: wa_bridge.set_group_picture
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  media_url: "https://example.com/group-photo.jpg"
```

#### Using a Local File
```yaml
service: wa_bridge.set_group_picture
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  media_path: "/config/group-photo.jpg"
```

## Sending Broadcast Messages
You can send messages to multiple targets using the service:

```yaml
service: wa_bridge.send_broadcast
data:
  message: "Hello everyone! This is a broadcast."
  targets:
    - "Family Group"      # Group name
    - "40741234567"       # Phone number
```

### Sending Polls
You can send polls using the `wa_bridge.send_poll` service:

```yaml
service: wa_bridge.send_poll
data:
  message: "What should we have for dinner?"
  options:
    - "Pizza"
    - "Sushi"
    - "Burgers"
  allow_multiple_answers: true
  number: "40741234567" # OR group: "Group Name" OR group_id: "120363012345678901"
```

### Sending Events
You can send WhatsApp calendar events using the `wa_bridge.send_event` service. Events include a name, start time, and optional description, location, end time, and call link.

```yaml
service: wa_bridge.send_event
data:
  number: "40741234567" # OR group: "Group Name" OR group_id: "120363012345678901"
  name: "Weekly Team Meeting"
  description: "Discuss project updates and next steps"
  location: "Conference Room A" # OR meeting link https://teams.microsoft.com/l/meetup-join/
  start_time: "2026-06-15T14:00:00"
  end_time: "2026-06-15T15:00:00"
  call_type: "video" # Optional: video, voice, or none
```

#### Minimal Example
Only `name` and `start_time` are required:

```yaml
service: wa_bridge.send_event
data:
  number: "40741234567"
  name: "Dentist Appointment"
  start_time: "2026-06-20T10:30:00"
```

### Automation Trigger for Polls
Trigger actions when a user votes on a poll using the `whatsapp_poll_vote_received` event.

The event contains:
- `voter`: The phone number of the voter (e.g. `40741234567`)
- `selectedOptions`: An array of the options selected
- `group_id`: The ID of the group if the poll was in a group, otherwise null

```yaml
trigger:
  - platform: event
    event_type: whatsapp_poll_vote_received
    # Optional: trigger only for a specific voter
    # event_data:
    #   voter: "40741234567" 
action:
  - service: notify.persistent_notification
    data:
      message: "Received a vote from {{ trigger.event.data.voter }}! Selected options: {{ trigger.event.data.selectedOptions | map(attribute='name') | list | join(', ') }}"
```

### Sending Media
You can send images or files using either a URL (`media_url`) or a local path (`media_path`).

#### Using a URL
```yaml
service: wa_bridge.send_message
data:
  number: "40741234567"
  message: "Check this out!"
  media_url: "https://www.home-assistant.io/images/favicon.ico"
```

#### Using a Local File
Ensure the path is accessible by Home Assistant, for example under `/config` or `/media`. Avoid `/config/www` for private files, because everything there is served unauthenticated at `/local/`.
```yaml
service: wa_bridge.send_broadcast
data:
  targets: ["Family Group", "40741234567"]
  message: "Security Snapshot"
  media_path: "/config/camera_snapshot.jpg"
```

### Automation Trigger
Trigger actions when a specific message is received:

```yaml
trigger:
  - platform: wa_bridge
    from_number: "40741234567"
    contains_text: "Turn on lights" # Optional
action:
  - service: light.turn_on
    target:
      entity_id: light.living_room
```

### Group Message Trigger
To trigger an automation from a group message, use `from_group` with the exact group name:

```yaml
trigger:
  - platform: wa_bridge
    from_group: "Family Group"
    contains_text: "Dinner" # Optional
action:
  - service: notify.persistent_notification
    data:
      message: "Dinner time!"
```

### Group Message Trigger by ID
For more stable automations, use `from_group_id` instead of `from_group`. The group ID remains the same even if the group name changes:

```yaml
trigger:
  - platform: wa_bridge
    from_group_id: "120363012345678901"
    contains_text: "Dinner" # Optional
    equals_text: "Dinner ready" # Optional
action:
  - service: notify.persistent_notification
    data:
      message: "Dinner time!"
```

### Channel Message Trigger
WhatsApp Community channels are treated as groups internally. You can trigger automations from channel messages using `from_group` or `from_group_id`, just like regular groups:

```yaml
trigger:
  - platform: wa_bridge
    from_group: "Announcements" # Exact channel name
    contains_text: "update" # Optional
    equals_text: "update received" # Optional
action:
  - service: notify.persistent_notification
    data:
      message: "New channel update received!"
```

For more stable automations, use `from_group_id` with the channel's numeric ID. Channel events use a `@newsletter` id. A bare number still matches, with or without `@g.us` or `@newsletter`. The ID remains the same even if the channel is renamed:

```yaml
trigger:
  - platform: wa_bridge
    from_group_id: "120363428200052636" # Channel ID from the bridge logs
    contains_text: "update" # Optional
action:
  - service: notify.persistent_notification
    data:
      message: "New channel update received!"
```

## Installation

### 1. Run the Bridge

#### Option A: Home Assistant Add-on (Recommended for HA OS)
1.  Go to **Settings > Add-ons > Add-on Store**.
2.  Click the **dots (top-right) > Repositories**.
3.  Add this repository URL: `https://github.com/raulpetruta/ha-wa-bridge`
4.  Reload the store and install **WhatsApp Bridge**.
5.  Open the **Configuration** tab, generate an API token with `openssl rand -hex 32`, paste it into **API token** and save. The add-on will not start without it, and the same token is needed when you add the integration.
6.  Start the Add-on. Accounts linked before v2.4.0 need to scan the QR code again. The bridge no longer keeps a browser session. Logging out of the linked device clears the saved session and waits for you to restart the add-on before it shows a new QR code.

#### Option B: Docker (For Container/Core users)
This project requires a small bridge service. Create a `docker-compose.yaml` file with the following content:

```yaml
services:
  ha-wa-bridge:
    image: ghcr.io/raulpetruta/ha-wa-bridge:latest
    container_name: ha-wa-bridge
    restart: unless-stopped
    ports:
      # Keep this port off the internet: every connection must present API_TOKEN.
      - "3000:3000"
    volumes:
      - ${CONFIG_DIR}/ha-wa-bridge/.wa_auth:/usr/src/app/.wwebjs_auth
      # Received media is stored outside /config/www, which HA serves unauthenticated
      - ${MEDIA_DIR}/whatsapp:/media/whatsapp
    environment:
      # REQUIRED: shared secret the integration must send. Generate: openssl rand -hex 32
      - API_TOKEN=replace-with-a-long-random-token

      # Forward messages you send yourself (groups only)
      - DETECT_OWN_MESSAGES=false

      # Incoming message mode: all | disabled | groups_only | numbers_only
      # - all          → forward everything (default)
      # - disabled     → send-only mode, no incoming messages processed
      # - groups_only  → group chats only, ignore 1-to-1 messages
      # - numbers_only → direct messages from ALLOWED_NUMBERS only
      - INCOMING_MESSAGES_MODE=all

      # Logging level for incoming messages: FULL | COMPACT | NONE
      # - FULL    → log entire message payload (default)
      # - COMPACT → log only sender and message type
      # - NONE    → disable logging for incoming messages
      - INCOMING_MESSAGE_LOG_LEVEL=FULL

      # Save received photos and files outside /config/www
      - MEDIA_DOWNLOAD_PATH=/media/whatsapp

      # Comma-separated group names — only these groups are forwarded (optional)
      # - ALLOWED_GROUPS=Family Group,Work Team

      # Comma-separated phone numbers without '+' — only these numbers are forwarded (optional)
      # Required for numbers_only mode
      # - ALLOWED_NUMBERS=40741234567,49123456789
```

Before starting the container, replace `replace-with-a-long-random-token` with a real secret (`openssl rand -hex 32`) and keep it for the integration setup. `${CONFIG_DIR}` is your Home Assistant config folder and `${MEDIA_DIR}` is a folder for received media.

Then run:
```bash
docker-compose up -d
```

### 2. Install the Integration

#### Option A: Marketplace / HACS (Recommended)
1.  **Home Assistant 2026.11+**: open **Settings > Marketplace**, search for **WhatsApp Integration** and click **Download**.
2.  **Older versions**: make sure [HACS](https://hacs.xyz/) is installed, then search for **WhatsApp Integration** under HACS > Integrations and click **Download**. If it is not listed yet, add `https://github.com/raulpetruta/ha-wa-bridge` as a custom repository of type **Integration**.
3.  Restart Home Assistant.

> The Marketplace and HACS install only the integration. The bridge (step 1) is a separate service that you run yourself, and the integration does nothing without it.

#### Option B: Manual Installation
1.  Copy the `custom_components/wa_bridge` folder to your Home Assistant `config/custom_components/` directory.
2.  Restart Home Assistant.

### Upgrading from 2.x

Version 3.0.0 renames the integration domain from `whatsapp` to `wa_bridge`, because `whatsapp` is already used by another integration in the HACS catalog. This is a breaking change:

1. Remove the old **WhatsApp Integration** entry under **Settings → Devices & services**.
2. Delete `custom_components/whatsapp` from your Home Assistant config folder (HACS does not remove it for you), then install this version and restart.
3. Add **WhatsApp Bridge** again with the same bridge WebSocket URL and the API token configured in the bridge. The bridge add-on or container stays linked to your WhatsApp account.
4. Update your automations and scripts:
   - Services: `whatsapp.send_message` (and the other `whatsapp.*` services) become `wa_bridge.*`.
   - Triggers: `platform: whatsapp` becomes `platform: wa_bridge`, and device triggers need to be picked again.
   - Unchanged: `notify.whatsapp`, the `whatsapp_*_received` events, and the bridge configuration.

The API token introduced in 3.1.0 is required as well — see **Upgrading from 3.0.x** below for the bridge-side steps.

### Upgrading from 3.0.x

Version 3.1.0 makes the bridge API token mandatory and changes the recommended location for received media.

1. Generate a token: `openssl rand -hex 32`.
2. Add the token to the bridge: Add-on users open the **Configuration** tab and set **API token**, then save and restart the add-on. Docker users add `API_TOKEN=<token>` to the container environment and restart it.
3. Update the integration: Home Assistant shows a **Reauthenticate** prompt for the existing entry. Enter the same token (the bridge URL is pre-filled) and submit. If no prompt appears, remove and re-add the integration; saved notify targets are kept in the config entry options.
4. If `media_download_path` points under `/config/www`, move it to `/media/whatsapp` (mount that folder for Docker) and restart the bridge. Files already saved stay where they are.
5. If the bridge logs that it is refusing to start without an API token, the option is still empty — set it before starting the container.

## Configuration

### Add-on Configuration
If you are using the Home Assistant Add-on, you can configure the following options in the add-on configuration tab:

- **`api_token`**: **Required.** Shared secret that every WebSocket client must send before it can control the bridge. Generate a long random value with `openssl rand -hex 32`, paste it here, and enter the same value in the integration's **API token** field. The bridge refuses to start while this is empty. Keep the token private.

- **`detect_own_messages`**: Set to `true` to forward messages sent by your own account (e.g., from WhatsApp Web or your phone). Works for group messages only. Default: `false`.

- **`incoming_messages_mode`**: Controls which incoming messages are forwarded to Home Assistant. Accepted values:
  - `all` *(default)* – all messages are forwarded, same as previous behaviour.
  - `disabled` – the message listener is **never registered**; the container uses minimal resources and is still fully capable of sending messages.
  - `groups_only` – only messages from group chats are forwarded; 1-to-1 conversations are ignored.
  - `numbers_only` – only direct messages from phone numbers listed in `allowed_numbers` are forwarded; group messages are ignored.

- **`incoming_message_log_level`**: Controls the amount of detail logged in the Add-on logs when receiving messages or poll votes. Accepted values:
  - `FULL` *(default)* – logs the entire raw message payload.
  - `COMPACT` – logs only basic info like sender identification and message type ("Message received from X"). Message bodies and selected options are omitted.
  - `NONE` – disables all logging for incoming messages. This is the most private option.

- **`allowed_groups`**: An optional list of group names. When set, **only** messages from groups whose name exactly matches one of the entries are forwarded. Useful if you only care about a single group. Example:
  ```yaml
  allowed_groups:
    - "Family Group"
    - "Work Team"
  ```
  Leave empty (default) to apply no group-name filter.

- **`allowed_numbers`**: An optional list of phone numbers (international format, no `+`). When set, **only** messages from those numbers are forwarded. Required when using `numbers_only` mode; also works as an extra filter in `all` mode. Example:
  ```yaml
  allowed_numbers:
    - "40741234567"
    - "49123456789"
  ```
  Leave empty (default) to apply no number filter.

- **`media_download_path`**: Optional directory for received photos, videos, and files. Leave empty to skip downloads. The add-on has read-write access to `/config` and `/media`; use `/media/whatsapp`, which Home Assistant does not serve over HTTP. Example:
  ```yaml
  media_download_path: /media/whatsapp
  ```
  Do **not** point this at `/config/www` (or anything below it): everything under `/config/www` is served **unauthenticated** at `/local/`, so received private photos and files would be readable by anyone who can reach your instance. Files that pass the incoming-message filters are saved there. The message event includes `mediaPath`, `mediaFilename`, and `mediaMimetype`. Use `allowed_groups` if you only want one group's photos.

  ```yaml
  trigger:
    - platform: wa_bridge
      from_group: "Photo Updates"
  action:
    - service: notify.persistent_notification
      data:
        message: "Saved {{ trigger.event.mediaPath }}"
  ```

### Docker Compose Configuration
All options are also available as environment variables:
```yaml
    environment:
      # REQUIRED: shared secret the integration must send (openssl rand -hex 32)
      - API_TOKEN=replace-with-a-long-random-token
      - DETECT_OWN_MESSAGES=true
      # Options: all | disabled | groups_only | numbers_only
      - INCOMING_MESSAGES_MODE=disabled
      # Options: FULL | COMPACT | NONE
      - INCOMING_MESSAGE_LOG_LEVEL=FULL
      # Comma-separated group names (optional)
      - ALLOWED_GROUPS=Family Group,Work Team
      # Comma-separated phone numbers without '+' (optional)
      - ALLOWED_NUMBERS=40741234567,49123456789
      # Directory for received media. Mount this path into the container and
      # keep it outside /config/www, which Home Assistant serves unauthenticated.
      - MEDIA_DOWNLOAD_PATH=/media/whatsapp
```

### Integration Setup

1.  Go to **Settings > Devices & Services**.
2.  Click **Add Integration** and search for **WhatsApp**.
3.  Enter the bridge **WebSocket URL** and the **API token** configured on the bridge, then submit. For the add-on, the hostname is shown on its **Info** tab and the port on its **Configuration** tab, for example `ws://cf9fc682-ha-wa-bridge:3000`. For Docker, use the bridge's host and port, for example `ws://homeassistant.local:3000`.
4.  The integration is added immediately. Check your **Home Assistant Notifications** (bell icon) for the QR code.
5.  **Scan the QR Code** with your WhatsApp mobile app (Linked Devices).

## Credits 
Powered by [Baileys](https://github.com/WhiskeySockets/Baileys).

## Support the project
- [Buy Me a Coffee](https://buymeacoffee.com/raulpetruta)
- [PayPal](https://www.paypal.me/raulpetruta98)

## Supporters 🙏

Thanks to these legends for buying me a [coffee](https://buymeacoffee.com/raulpetruta):

- Jblox6
- @louis_remi
- Pattio
- Ni3k

Thanks to these legends for their [PayPal](https://www.paypal.me/raulpetruta98) support:

- Enrique Alarcon

## Star History

<a href="https://www.star-history.com/?repos=raulpetruta%2Fha-wa-bridge&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=raulpetruta/ha-wa-bridge&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=raulpetruta/ha-wa-bridge&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=raulpetruta/ha-wa-bridge&type=date&legend=top-left" />
 </picture>
</a>

## License
[MIT](LICENSE)
