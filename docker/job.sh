#!/bin/bash

echo "INFO: Starting photo sync PID $$ $(date)"

if [ -n "$HEALTHCHECK_ID" ]; then
  curl -sS -X POST -o /dev/null "$HEALTHCHECK_HOST/$HEALTHCHECK_ID/start"
fi

# Environment variables

PARAMS="--session-directory ./sessiond --photo-directory ./downloadd"
if [ -n "$INITIAL_PHOTO_URL" ]; then
  PARAMS="$PARAMS --initial-photo-url $INITIAL_PHOTO_URL"
fi
if [ -n "$WRITE_SCRAPED_EXIF" ]; then
  PARAMS="$PARAMS --write-scraped-exif $WRITE_SCRAPED_EXIF"
fi
if [ "$FLAT_DIRECTORY_STRUCTURE" == "true" ]; then
  PARAMS="$PARAMS --flat-directory-structure"
fi

# Execute script

node ./index.js start $PARAMS

EXIT_CODE=$(echo $?)

echo "INFO: Completed photo sync PID $$ $(date) with exit code $EXIT_CODE"

if [ -n "$HEALTHCHECK_ID" ]; then
  if [ "$EXIT_CODE" == "0" ]; then
    curl -sS -X POST -o /dev/null --fail "$HEALTHCHECK_HOST/$HEALTHCHECK_ID"
  else
    curl -sS -X POST -o /dev/null --fail "$HEALTHCHECK_HOST/$HEALTHCHECK_ID/fail"
  fi
fi