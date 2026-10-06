# OLEDFrame Studio

A standalone browser-based tool for converting videos into ESP32 + SSD1306 OLED animations and generating a ready-to-upload Arduino project.

## MVP

- Upload a browser-supported video
- Full-video or custom start/end clip
- 128x64 or 128x32 SSD1306 target
- Auto Optimize with Quality / Balanced / Maximum Compression
- Manual FPS, crop, brightness, contrast, threshold, dithering and playback settings
- OLED preview
- Frame count, size and ESP32 compatibility estimates
- Client-side frame conversion
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

## Run

Open the deployed site, or serve the repository locally with any static web server.

## Important

This version processes uploaded videos and direct browser-loadable video URLs. A normal YouTube watch-page URL is not itself a video file; a server-side media retrieval backend is planned separately.

## License

MIT
