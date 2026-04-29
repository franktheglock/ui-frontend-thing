# Multi-stage build for production
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:20-alpine AS server

WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/ .
COPY --from=frontend-builder /app/frontend/dist ../frontend/dist

ENV NODE_ENV=production
ENV PORT=3456

EXPOSE 3456

CMD ["npm", "start"]
