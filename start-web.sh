#!/bin/bash
export PATH=/home/linuxbrew/.linuxbrew/bin:/home/openclaw/.local/bin:/usr/local/bin:/usr/bin:/bin
cd "$(dirname "$0")/apps/web"
exec npx next start -p 3005
