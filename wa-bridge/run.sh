#!/bin/bash

# Detect Environment
if [ -d "/data" ]; then
    echo "Running in Home Assistant Add-on environment"
    export WA_DATA_PATH=/data
else
    echo "Running in Standard Docker environment"
    export WA_DATA_PATH=./.wwebjs_auth
fi

echo "Starting WhatsApp Bridge..."
sleep 3
exec npm start
