#!/bin/bash

# Detect Environment
if [ -d "/data" ]; then
    echo "Running in Home Assistant Add-on environment"
    export WA_DATA_PATH=/data
else
    echo "Running in Standard Docker environment"
    export WA_DATA_PATH=./.wwebjs_auth
fi

# Clean up stale locks to prevent "Browser already running" errors
SESSION_DIR="${WA_DATA_PATH}/session"
echo "Cleaning up locks in ${SESSION_DIR}..."
rm -rf "${SESSION_DIR}/Singleton"*
rm -rf "${SESSION_DIR}/*/Singleton"*

# Start the application
echo "Starting WhatsApp Bridge..."
sleep 3
exec npm start
