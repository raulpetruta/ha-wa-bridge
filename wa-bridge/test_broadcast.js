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
  
  // Wait for status
});

ws.on('message', function message(data) {
  const msg = JSON.parse(data);
  console.log('Received:', msg);
  
  if (msg.type === 'status' && (msg.status === 'ready' || msg.status === 'authenticated')) {
      console.log('Bridge is ready. Sending broadcast test...');
      
      const payload = {
          type: 'broadcast',
          targets: ['1234567890', 'Test Group'], // Replace with valid targets if possible, but this tests the logic path
          message: 'This is a broadcast test message from the test script.'
      };
      
      ws.send(JSON.stringify(payload));
      
      // Close after a short delay
      setTimeout(() => {
          console.log('Closing connection...');
          ws.close();
      }, 5000);
  }
});
