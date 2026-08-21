FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.js geminiThinking.js relayModelPolicy.js tokenOptimization.js welcomeEmail.js ./

USER node
EXPOSE 8080
CMD ["npm", "start"]
