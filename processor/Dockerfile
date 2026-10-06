FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip git ca-certificates \
  && python3 -m pip install --no-cache-dir --break-system-packages "yt-dlp[default]" "bgutil-ytdlp-pot-provider==2.0.1" \
  && git clone --depth 1 --branch 2.0.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
  && cd /opt/bgutil-ytdlp-pot-provider/server \
  && npm ci \
  && npx tsc \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY processor/package.json ./package.json
RUN npm install --omit=dev
COPY processor/server.js ./server.js

ENV NODE_ENV=production PORT=10000
EXPOSE 10000

CMD ["sh","-c","node /opt/bgutil-ytdlp-pot-provider/server/build/main.js >/tmp/bgutil.log 2>&1 & sleep 2; exec npm start"]
