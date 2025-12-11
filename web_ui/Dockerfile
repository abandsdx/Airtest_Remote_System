# Build static assets
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .

# Build-time API endpoints (overridable via build args)
ARG VITE_API_BASE=http://localhost:8081
ARG VITE_WS_BASE=ws://localhost:8081
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_WS_BASE=${VITE_WS_BASE}

RUN npm run build

# Serve with nginx
FROM nginx:alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
