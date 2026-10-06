FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
COPY processor/package.json ./package.json
RUN npm install --omit=dev
COPY processor/server.js ./server.js
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["npm","start"]
