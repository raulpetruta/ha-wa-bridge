> **Disclaimer from underlying library [whatsapp-web.js](https://wwebjs.dev/)**
> This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with WhatsApp or any of its subsidiaries or its affiliates. The official WhatsApp website can be found at [whatsapp](https://www.whatsapp.com). "WhatsApp" as well as related names, marks, emblems and images are registered trademarks of their respective owners. Also it is not guaranteed you will not be blocked by using this method. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe. For any businesses looking to integrate with WhatsApp for critical applications, we highly recommend using officially supported methods, such as Twilio's solution or other alternatives. You might also consider the [official API](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview).

# Home Assistant WhatsApp Integration

A custom integration to send and receive WhatsApp messages in Home Assistant naturally. It uses a local [whatsapp-web.js](https://wwebjs.dev/) bridge running in Docker.

## Features
- **Send Messages**: Use the `whatsapp.send_message` service in HA.
- **Group Messaging**: Send messages to WhatsApp groups by name or by group ID.
- **Group ID Support**: Target groups by their stable ID instead of name — automations won't break when a group is renamed.
- **Get Groups**: Retrieve all WhatsApp groups with their IDs using the `whatsapp.get_groups` service.
- **Set Group Subject**: Dynamically update a group's name using the `whatsapp.set_group_subject` service — perfect for automating group names based on schedules or sensor values.
- **Set Group Picture**: Update a group's picture using the `whatsapp.set_group_picture` service.
- **Receive Messages**: Trigger automations when messages arrive (including WhatsApp Community channels).
- **Send Events**: Send WhatsApp calendar events with name, location, and time using the `whatsapp.send_event` service.
- **Receive Filtering**: Disable incoming messages entirely or restrict to specific groups to save resources.
- **Easy Auth**: Scan a QR code in Home Assistant to link your account.

## Usage

### Sending a Messsage
You can send messages to any number using the service:

```yaml
service: whatsapp.send_message
data:
  number: "40741234567" # Country code + Number (no "+" symbol) 
  message: "Hello from Home Assistant! 🏠"
```

### Sending to a Group
You can send messages to a group by its exact name:

```yaml
service: whatsapp.send_message
data:
  group: "Family Group" # Exact name of the group
  message: "Dinner is ready! 🍽️"
```

### Sending to a Group by ID
You can send messages to a group using its stable ID. This is recommended for automations since the ID doesn't change when the group is renamed. Use the `whatsapp.get_groups` service to find group IDs; or check the add on logs while sending / receiving a message for a group to get the ID

```yaml
service: whatsapp.send_message
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  message: "Dinner is ready! 🍽️"
```

### Retrieving Group IDs
Use the `whatsapp.get_groups` service to retrieve all your WhatsApp groups with their IDs. The results are fired as a `whatsapp_groups_received` event.

```yaml
service: whatsapp.get_groups
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
You can dynamically update a group's name using the `whatsapp.set_group_subject` service. This is useful for automating group names based on schedules or template sensors. Requires admin permissions in the group.

```yaml
service: whatsapp.set_group_subject
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  subject: "Weekly Meeting - Monday 7PM"
```

### Setting a Group Picture
You can update a group's picture using the `whatsapp.set_group_picture` service. Supports both URL and local path. Requires admin permissions in the group.

#### Using a URL
```yaml
service: whatsapp.set_group_picture
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  media_url: "https://example.com/group-photo.jpg"
```

#### Using a Local File
```yaml
service: whatsapp.set_group_picture
data:
  group_id: "120363012345678901" # Group ID (use get_groups to find this)
  media_path: "www/group-photo.jpg"
```

## Sending Broadcast Messages
You can send messages to multiple targets using the service:

```yaml
service: whatsapp.send_broadcast
data:
  message: "Hello everyone! This is a broadcast."
  targets:
    - "Family Group"      # Group name
    - "40741234567"       # Phone number
```

### Sending Polls
You can send polls using the `whatsapp.send_poll` service:

```yaml
service: whatsapp.send_poll
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
You can send WhatsApp calendar events using the `whatsapp.send_event` service. Events include a name, start time, and optional description, location, end time, and call link.

```yaml
service: whatsapp.send_event
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
service: whatsapp.send_event
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
service: whatsapp.send_message
data:
  number: "40741234567"
  message: "Check this out!"
  media_url: "https://www.home-assistant.io/images/favicon.ico"
```

#### Using a Local File
Ensure the path is accessible by Home Assistant (e.g., in `config/www`).
```yaml
service: whatsapp.send_broadcast
data:
  targets: ["Family Group", "40741234567"]
  message: "Security Snapshot"
  media_path: "/config/www/camera_snapshot.jpg"
```

### Automation Trigger
Trigger actions when a specific message is received:

```yaml
trigger:
  - platform: whatsapp
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
  - platform: whatsapp
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
  - platform: whatsapp
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
  - platform: whatsapp
    from_group: "Announcements" # Exact channel name
    contains_text: "update" # Optional
    equals_text: "update received" # Optional
action:
  - service: notify.persistent_notification
    data:
      message: "New channel update received!"
```

For more stable automations, use `from_group_id` with the channel's numeric ID (without `@g.us`). The ID remains the same even if the channel is renamed:

```yaml
trigger:
  - platform: whatsapp
    from_group_id: "120363428200052636" # Channel ID (use get_groups or check bridge logs)
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
5.  Start the Add-on.

#### Option B: Docker (For Container/Core users)
This project requires a small bridge service. Create a `docker-compose.yaml` file with the following content:

```yaml
services:
  ha-wa-bridge:
    image: ghcr.io/raulpetruta/ha-wa-bridge:latest
    container_name: ha-wa-bridge
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ${CONFIG_DIR}/ha-wa-bridge/.wa_auth:/usr/src/app/.wwebjs_auth
      - ${CONFIG_DIR}/ha-wa-bridge/.wa_cache:/usr/src/app/.wwebjs_cache
    environment:
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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

      # Comma-separated group names — only these groups are forwarded (optional)
      # - ALLOWED_GROUPS=Family Group,Work Team

      # Comma-separated phone numbers without '+' — only these numbers are forwarded (optional)
      # Required for numbers_only mode
      # - ALLOWED_NUMBERS=40741234567,49123456789
```

Then run:
```bash
docker-compose up -d
```

### 2. Install the Integration

#### Option A: HACS (Recommended)
1.  Make sure [HACS](https://hacs.xyz/) is installed.
2.  Go to HACS > Integrations > Top-right menu > **Custom repositories**.
3.  Add `https://github.com/raulpetruta/ha-wa-bridge` as an **Integration**.
4.  Click **Download**.
5.  Restart Home Assistant.

#### Option B: Manual Installation
1.  Copy the `custom_components/whatsapp` folder to your Home Assistant `config/custom_components/` directory.
2.  Restart Home Assistant.

## Configuration

### Add-on Configuration
If you are using the Home Assistant Add-on, you can configure the following options in the add-on configuration tab:

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

### Docker Compose Configuration
All options are also available as environment variables:
```yaml
    environment:
      - DETECT_OWN_MESSAGES=true
      # Options: all | disabled | groups_only | numbers_only
      - INCOMING_MESSAGES_MODE=disabled
      # Options: FULL | COMPACT | NONE
      - INCOMING_MESSAGE_LOG_LEVEL=FULL
      # Comma-separated group names (optional)
      - ALLOWED_GROUPS=Family Group,Work Team
      # Comma-separated phone numbers without '+' (optional)
      - ALLOWED_NUMBERS=40741234567,49123456789
```

### Integration Setup

1.  Go to **Settings > Devices & Services**.
2.  Click **Add Integration** and search for **WhatsApp**.
4.  **Click Submit**. The integration will be added immediately.
    1. **if asked** for a host, see the WhatsApp Bridge Add-on for **hostname**(info-tab) and **port**(configuration-tab), eg. "ws://cf9fc682-ha-wa-bridge:3000"
5.  Check your **Home Assistant Notifications** (bell icon) for the QR code.
6.  **Scan the QR Code** with your WhatsApp mobile app (Linked Devices).

## Credits 
Powered by [whatsapp-web.js](https://wwebjs.dev/).

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
