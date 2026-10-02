FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV NERO_AUTH_DIR=/app/auth_info_baileys
ENV NODE_OPTIONS=--max-old-space-size=192

EXPOSE 8080

CMD ["npm", "start"]
