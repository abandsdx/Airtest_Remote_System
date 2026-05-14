# Use an official Node.js runtime as a parent image
FROM node:18-slim

WORKDIR /usr/src/app

# Copy server package manifests
COPY server/package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy server source
COPY server ./

# Copy frontend assets
COPY frontend ./frontend

# Create data directories
RUN mkdir -p /usr/src/app/data /usr/src/app/recordings

EXPOSE 3000

CMD [ "node", "src/index.js" ]
