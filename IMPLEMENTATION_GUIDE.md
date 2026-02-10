# WhatsApp Group Messaging - Implementation Guide

## Files Changed

1. **__init__.py** - Added `send_group_message` and `get_groups` service registration
2. **services.yaml** - Added service definitions for group messages and getting groups
3. **index.js** - Added handlers for `send_group_message` and `get_groups` commands
4. **client.py** - Added `send_group_message()` and `get_groups()` methods

## How to Use

### Getting Your Group IDs (Easy Way!)

Just call the service in Home Assistant:

1. Go to **Developer Tools > Services**
2. Select `whatsapp.get_groups`
3. Click **Call Service**
4. Check your **Notifications** (bell icon) - you'll see all your groups with their IDs!

The notification will show something like:
```
## WhatsApp Groups

**Family Chat**
`120363123456789012@g.us`

**Work Team**
`120363987654321098@g.us`
```

You can copy the group ID directly from there!

### Sending a Group Message

**In Home Assistant UI:**
1. Go to Developer Tools > Services
2. Select `whatsapp.send_group_message`
3. Fill in:
   - Group ID: `120363123456789012@g.us`
   - Message: Your message text

**In Automations:**

```yaml
service: whatsapp.send_group_message
data:
  group_id: "120363123456789012@g.us"
  message: "Garage door has been open for 10 minutes! 🚨"
```

**In Scripts:**

```yaml
notify_family_group:
  sequence:
    - service: whatsapp.send_group_message
      data:
        group_id: "120363123456789012@g.us"
        message: "Home Assistant: {{ trigger.to_state.attributes.friendly_name }} is {{ trigger.to_state.state }}"
```

### Example Automation: Motion Alert to Group

```yaml
automation:
  - alias: "Alert family group on motion"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door_motion
        to: "on"
    action:
      - service: whatsapp.send_group_message
        data:
          group_id: "120363123456789012@g.us"
          message: "🚨 Motion detected at front door!"
```

### Example Automation: Daily Weather to Group

```yaml
automation:
  - alias: "Daily weather to family group"
    trigger:
      - platform: time
        at: "07:00:00"
    action:
      - service: whatsapp.send_group_message
        data:
          group_id: "120363123456789012@g.us"
          message: >
            Good morning! ☀️
            Today's forecast: {{ states('weather.home') }}
            Temperature: {{ state_attr('weather.home', 'temperature') }}°C

## All Available Services

### 1. whatsapp.send_message
Send a message to an individual number.

### 2. whatsapp.send_group_message  
Send a message to a WhatsApp group.

### 3. whatsapp.get_groups
Fetch all your groups and their IDs. Results appear in a notification.

## Testing

1. Replace the files in your integration
2. Restart Home Assistant
3. Check Developer Tools > Services - you should see both:
   - `whatsapp.send_message`
   - `whatsapp.send_group_message`
4. Send a test message to a group you're in

## Tips

- Group IDs always end with `@g.us`
- Individual numbers end with `@c.us`
- The bridge will auto-format if you forget the suffix
- Keep your group IDs in a script or input_text entity for easy reuse
- Use the message event logs to discover your group IDs

## Troubleshooting

**Error: "WebSocket not connected"**
- Make sure your bridge container is running
- Check the bridge logs: `docker logs ha-wa-bridge`

**Message not delivered to group**
- Verify you're a member of the group
- Check the group ID format includes `@g.us`
- Look at bridge container logs for error messages

**Can't find group ID**
- Enable the logging code above in index.js
- Restart the bridge container
- Check the Docker logs to see the list of groups
