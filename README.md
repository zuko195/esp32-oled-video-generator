# OLEDFrame Studio

A standalone web app that converts videos into ESP32 + SSD1306 OLED animations and generates a ready-to-upload Arduino project.

## Current architecture

- **Vercel:** website/frontend at the repository root
- **Render:** optional server-side media processor under `processor/`
- **Vercel API config:** `api/config.js`

The browser-only path processes uploaded videos locally. The media processor adds URL/YouTube metadata lookup and server-side conversion for links that cannot be loaded into a browser canvas directly.

## Features

- Upload a browser-supported video
- Full-video or custom start/end clip
- 128x64 and 128x32 SSD1306 targets
- Auto Optimize with Quality / Balanced / Maximum Compression
- Manual FPS, crop, brightness, contrast, threshold, dithering and playback settings
- OLED preview
- Frame count, size and ESP32 compatibility estimates
- Client-side frame conversion for uploaded videos
- Server-side URL/YouTube processing through the optional processor
- Optional per-frame RLE compression
- ZIP generation containing:
  - ESP32_OLED_Animation.ino
  - animation.h
  - README.txt

## Hardware default

- ESP32 WROOM-32
- SSD1306 128x64
- SDA -> GPIO 21
- SCL -> GPIO 22
- I2C address -> 0x3C

## Vercel deployment

Import the repository into Vercel with the project root set to the repository root.

After the media processor is deployed, add this Vercel environment variable:

`PROCESSOR_URL=https://YOUR-RENDER-SERVICE.onrender.com`

The website reads it through `/api/config`.

## Render processor deployment

The processor is defined by `processor/Dockerfile` and `processor/render.yaml`.

A Render Web Service can use the repository's Docker configuration. The service exposes:

- `GET /health`
- `POST /api/info`
- `POST /api/preview`
- `POST /api/convert`

The processor uses FFmpeg and yt-dlp. It is intended for personal/hobby testing and is intentionally limited to 10-minute clips in this prototype.

## Important video URL note

A normal YouTube watch-page URL is not an MP4 file that a browser can draw into a canvas. The optional processor resolves permitted/accessible media server-side and converts it into OLED animation data.

## Run the frontend locally

Serve the repository root with any static HTTP server, then open the site in a browser.

## Run the processor locally

Install Node 20+, FFmpeg and yt-dlp, then:

```bash
cd processor
npm install
npm start
```

Set `PROCESSOR_URL` on the frontend to the processor's base URL.

## License

MIT
