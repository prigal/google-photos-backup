#!/bin/bash

if [ -n "$CRON" ]; then
    # Make env variables available in cronjobs
    printenv | grep -v "no_proxy" >> /etc/environment
    echo "$CRON cd /usr/src/app/ && bash job.sh > /proc/1/fd/1 2>&1" > /etc/cron.d/sync_job
    chmod 0755 /etc/cron.d/sync_job
    crontab /etc/cron.d/sync_job
    echo "Starting Google Photo Sync in cron mode"
    cron -f
else
    bash job.sh
fi