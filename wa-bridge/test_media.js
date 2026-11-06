const WebSocket = require('ws');

// Authenticate with the bridge API token (add-on option api_token / Docker env API_TOKEN).
const token = process.env.API_TOKEN;
if (!token) {
    console.error('Set API_TOKEN to the bridge API token before running this script.');
    process.exit(1);
}

const ws = new WebSocket('ws://localhost:3000', { headers: { Authorization: `Bearer ${token}` } });

ws.on('open', function open() {
  console.log('Connected to WA Bridge');
});

ws.on('message', function message(data) {
  const msg = JSON.parse(data);
  // console.log('Received:', msg);
  
  if (msg.type === 'status' && (msg.status === 'ready' || msg.status === 'authenticated')) {
      console.log('Bridge is ready. Sending media test...');
      
      // Small 1x1 red pixel base64 png
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      
      const payload = {
          type: 'send_message',
          number: '1234567890', // Replace with valid number or use your own if testing live
          message: 'This is a media test message.',
          media: {
              mimetype: 'image/png',
              data: base64Image,
              filename: 'test.png'
          }
      };
      
      ws.send(JSON.stringify(payload));
      
      // Also test broadcast with media
      const broadcastPayload = {
          type: 'broadcast',
          targets: ['Test Group'], 
          message: 'Broadcast media test',
          media: {
              mimetype: 'image/png',
              data: base64Image,
              filename: 'broadcast_test.png'
          }
      };

      setTimeout(() => {
          console.log('Sending broadcast media test...');
          ws.send(JSON.stringify(broadcastPayload));
      }, 2000);

      // Close after a delay
      setTimeout(() => {
          console.log('Closing connection...');
          ws.close();
      }, 5000);
  } else if (msg.type === 'qr') {
      console.log('QR Code received (waiting for auth...)');
  }
});
