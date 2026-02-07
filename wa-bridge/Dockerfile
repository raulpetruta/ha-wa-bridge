FROM node:18-slim

# Install system dependencies for Puppeteer
RUN apt-get update \
    && apt-get install -y git chromium fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 openssh-client \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

# Apply Hotfix during build to ensure it's baked into the image
RUN node patch-fix.js

RUN chmod +x run.sh

EXPOSE 3000

CMD [ "./run.sh" ]
