FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.js geminiThinking.js relayModelPolicy.js tokenOptimization.js vertexErrorPolicy.js vertexEndpoint.js vertexStream.js openAiStream.js vertexToolTurns.js vertexRequestRouting.js welcomeEmail.js licenseEmailMime.js releaseMetadata.js ./

USER node
EXPOSE 8080
CMD ["npm", "start"]
