FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
# قاعدة البيانات تُحفظ في /app/storage (يُربط به القرص الدائم في الاستضافة)
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/storage
COPY --from=build /app/dist ./dist
COPY content ./content
RUN mkdir -p /app/storage
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
