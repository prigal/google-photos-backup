#!/bin/bash

if [ -n "$CRON" ]; then
    echo "$CRON cd /usr/src/app/ && bash /usr/src/app/job.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/sync_job
    chmod 0755 /etc/cron.d/sync_job
    crontab /etc/cron.d/sync_job
    echo "Starting Google Photo Sync in cron mode"
    cron
    tail -f /var/log/cron.log
else
    bash job.sh
fi