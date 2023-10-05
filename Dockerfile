FROM mcr.microsoft.com/playwright

# Create app directory
WORKDIR /usr/src/app

RUN apt-get update && apt-get -y install cron

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm ci --omit=dev
RUN npx playwright install --with-deps chromium

# Copy app source
COPY src/. .

# Copy docker bashs cripts
COPY docker/job.sh .
RUN chmod +x ./job.sh

COPY docker/entrypoint.sh .
RUN chmod +x ./entrypoint.sh

# Create the log file to be able to run tail
RUN touch /var/log/cron.log

RUN apt-get update && apt-get -y install nano

ENV \
    CRON="" \
    HEALTHCHECK_ID="" \
    HEALTHCHECK_HOST="https://hc-ping.com"

CMD [ "./entrypoint.sh" ]