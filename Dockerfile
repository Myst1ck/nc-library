# Build stage — Vite production bundle (base /library/).
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage — nginx, app mounted under /library.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/library
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]