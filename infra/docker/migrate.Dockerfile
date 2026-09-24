FROM node:22-alpine

WORKDIR /app
COPY . .
RUN npm ci

# Migra el esquema y asegura la installation (infra mínima, idempotente, sin
# datos demo). Ambos pasos son seguros de reejecutar.
CMD ["sh", "-c", "npm run db:mi && npm run db:seed"]