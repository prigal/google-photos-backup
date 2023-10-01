FROM mcr.microsoft.com/playwright

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm ci --omit=dev
RUN npx playwright install --with-deps chromium

# Bundle app source
COPY . .

CMD [ "npm", "start" ]