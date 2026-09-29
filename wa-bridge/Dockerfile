FROM node:22-slim

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci

COPY . .

RUN chmod +x run.sh

EXPOSE 3000

CMD [ "./run.sh" ]
