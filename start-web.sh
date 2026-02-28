#!/bin/bash
export PATH=/home/linuxbrew/.linuxbrew/bin:/home/openclaw/.local/bin:/usr/local/bin:/usr/bin:/bin
cd /home/openclaw/projects/agentteams/apps/web
exec npx next start -p 3005
