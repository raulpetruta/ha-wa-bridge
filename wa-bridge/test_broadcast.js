const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

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
