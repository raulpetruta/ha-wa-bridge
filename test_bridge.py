import asyncio
import aiohttp
import json
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
_LOGGER = logging.getLogger(__name__)

async def test_bridge():
    url = "ws://localhost:3000"
    
    async with aiohttp.ClientSession() as session:
        _LOGGER.info(f"Connecting to {url}...")
        async with session.ws_connect(url) as ws:
            _LOGGER.info("Connected!")
            
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    _LOGGER.info(f"Received: {data['type']}")
                    
                    if data['type'] == 'qr':
                        _LOGGER.info("QR Code received (truncated): %s...", data['data'][:20])
                        # We received QR, test passed for connection
                        break
                        
                    if data['type'] == 'status' and data['status'] == 'ready':
                        _LOGGER.info("Client is ready!")
                        break
                        
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    _LOGGER.error("Error: %s", ws.exception())
                    break

if __name__ == "__main__":
    asyncio.run(test_bridge())
