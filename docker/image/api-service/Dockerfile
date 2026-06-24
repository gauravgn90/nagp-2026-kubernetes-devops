FROM node:24-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

COPY package*.json ./

COPY app.js ./

RUN npm install

EXPOSE 3000

CMD [ "npm", "start" ]