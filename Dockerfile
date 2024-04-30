FROM node:20

WORKDIR /usr/src/app

COPY package.json package.json
COPY package-lock.json package-lock.json
COPY src src
COPY test/prompts/hatchify-assistant.json test/prompts/hatchify-assistant.json

RUN npm ci

CMD ["npm", "run", "start"]
