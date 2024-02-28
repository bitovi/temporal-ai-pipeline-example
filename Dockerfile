FROM node:20

WORKDIR /usr/src/app

COPY package.json package.json
COPY package-lock.json package-lock.json
COPY src src

RUN npm ci

CMD ["npm", "run", "start"]
