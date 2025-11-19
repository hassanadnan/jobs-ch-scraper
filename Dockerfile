# Use official Playwright image with browsers preinstalled
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy app
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]


