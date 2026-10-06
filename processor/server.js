import express from 'express';
import cors from 'cors';
import archiver from 'archiver';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const MAX_DURATION_SECONDS = 600;
const ALLOWED_WIDTHS = new Set([128]);
const ALLOWED_HEIGHTS = new Set([32, 64]);

app.use(cors({ origin: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '64kb' }));

function n(value, fallback, min, max) {
  const x = Number(value);
  return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback;
}

function youtubeArgs(extra=[]) {
  return [
    ...extra,
    '--js-runtimes','node',
    '--extractor-args','youtubepot-bgutilscript:script_path=/opt/bgutil-ytdlp-pot-provider/server/build/generate_once.js',
    '--extractor-args','youtube:player-client=mweb'
  ];
}

function isYoutube(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return ['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host);
  } catch { return false; }
}

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', killed = false;
    const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', d => { if (stdout.length < 4000000) stdout += d.toString(); });
    p.stderr.on('data', d => { if (stderr.length < 100000) stderr += d.toString(); });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (killed) return reject(new Error(cmd + ' timed out'));
      if (code !== 0) return reject(new Error(stderr.trim().split('\n').slice(-8).join('\n') || (cmd + ' failed')));
      resolve({ stdout, stderr });
    });
  });
}

async function infoFor(url) {
  try { new URL(url); } catch { throw new Error('Invalid video URL.'); }
  if (isYoutube(url)) {
    const { stdout } = await run('yt-dlp', youtubeArgs(['--dump-single-json', '--no-playlist', '--no-warnings', url]), 90000);
    const d = JSON.parse(stdout);
    return {
      title: d.title || 'YouTube video',
      duration: Number(d.duration || 0),
      width: Number(d.width || 0),
      height: Number(d.height || 0),
      fps: Number(d.fps || 0) || null,
      source: 'youtube'
    };
  }

  const { stdout } = await run('ffprobe', [
    '-v','error','-print_format','json','-show_streams','-show_format',url
  ], 90000);
  const d = JSON.parse(stdout);
  const v = (d.streams || []).find(s => s.codec_type === 'video');
  if (!v) throw new Error('No video stream was found.');
  const parts = String(v.r_frame_rate || '').split('/');
  const fps = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(v.r_frame_rate);
  return {
    title: url.split('/').pop()?.split('?')[0] || 'Remote video',
    duration: Number(v.duration || d.format?.duration || 0),
    width: Number(v.width || 0),
    height: Number(v.height || 0),
    fps: Number.isFinite(fps) && fps > 0 ? fps : null,
    source: 'direct'
  };
}

async function playableUrl(url) {
  if (!isYoutube(url)) return url;
  const { stdout } = await run('yt-dlp', youtubeArgs([
    '-g','--no-playlist',
    '-f','bestvideo[height<=720]/bestvideo/best',
    url
  ]), 120000);
  const first = stdout.trim().split(/\r?\n/).find(Boolean);
  if (!first) throw new Error('yt-dlp did not return a playable video stream.');
  return first;
}

function packedFrame(gray, width, height, o) {
  const px = new Float32Array(gray.length);
  for (let i=0;i<gray.length;i++) px[i] = Math.max(0, Math.min(255, (gray[i]-128)*o.contrast+128+o.brightness));

  if (o.dither === 'floyd') {
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const i=y*width+x, old=px[i], on=old>=o.threshold, next=on?255:0, err=old-next;
      px[i]=next;
      if (x+1<width) px[i+1]=Math.max(0,Math.min(255,px[i+1]+err*7/16));
      if (y+1<height) {
        if (x>0) px[i+width-1]=Math.max(0,Math.min(255,px[i+width-1]+err*3/16));
        px[i+width]=Math.max(0,Math.min(255,px[i+width]+err*5/16));
        if (x+1<width) px[i+width+1]=Math.max(0,Math.min(255,px[i+width+1]+err/16));
      }
    }
  }

  const out=new Uint8Array(Math.ceil(width*height/8));
  const matrix=[0,2,3,1];
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const idx=y*width+x;
    const offset=o.dither==='ordered' ? (matrix[(y&1)*2+(x&1)]-1.5)*28 : 0;
    let on=px[idx] >= o.threshold+offset;
    if(o.invert) on=!on;
    if(on) out[idx>>3] |= 1 << (7-(idx&7));
  }
  return out;
}

function same(a,b) {
  if(!a || !b || a.length!==b.length) return false;
  for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return false;
  return true;
}

function rle(data) {
  const out=[];
  for(let i=0;i<data.length;) {
    const v=data[i]; let j=i+1;
    while(j<data.length && data[j]===v && j-i<255) j++;
    out.push(j-i,v); i=j;
  }
  return Uint8Array.from(out);
}

function hex(data) {
  const rows=[];
  for(let i=0;i<data.length;i+=16) {
    const row=[];
    for(let j=i;j<Math.min(i+16,data.length);j++) row.push('0x'+data[j].toString(16).padStart(2,'0'));
    rows.push('  '+row.join(', '));
  }
  return rows.join(',\n');
}

function lines(data, per=12) {
  const rows=[];
  for(let i=0;i<data.length;i+=per) rows.push('  '+data.slice(i,i+per).join(', '));
  return rows.join(',\n');
}

function buildHeader(frames,delays,w,h,compression) {
  const rawBytes=Math.ceil(w*h/8), data=[], offsets=[], lengths=[], rawFlags=[];
  for(const frame of frames) {
    const c=rle(frame), useRaw=!compression || c.length>=frame.length, payload=useRaw?frame:c;
    offsets.push(data.length); lengths.push(payload.length); rawFlags.push(useRaw?1:0); data.push(...payload);
  }
  const packed=Uint8Array.from(data);
  return `#pragma once
#include <Arduino.h>
#include <pgmspace.h>

#define OLED_ANIM_FRAME_COUNT ${frames.length}u
#define OLED_ANIM_WIDTH ${w}u
#define OLED_ANIM_HEIGHT ${h}u
#define OLED_ANIM_BYTES_PER_FRAME ${rawBytes}u
#define OLED_ANIM_DATA_SIZE ${packed.length}u

static const uint32_t OLED_ANIM_OFFSETS[OLED_ANIM_FRAME_COUNT] PROGMEM = {
${lines(offsets)}
};
static const uint32_t OLED_ANIM_LENGTHS[OLED_ANIM_FRAME_COUNT] PROGMEM = {
${lines(lengths)}
};
static const uint8_t OLED_ANIM_RAW[OLED_ANIM_FRAME_COUNT] PROGMEM = {
${lines(rawFlags)}
};
static const uint16_t OLED_ANIM_DELAYS[OLED_ANIM_FRAME_COUNT] PROGMEM = {
${lines(delays)}
};
static const uint8_t OLED_ANIM_DATA[OLED_ANIM_DATA_SIZE] PROGMEM = {
${hex(packed)}
};
`;
}

function buildSketch(w,h,loopOn) {
  return `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <string.h>
#include "animation.h"

#define OLED_ADDRESS 0x3C
#define OLED_RESET -1

Adafruit_SSD1306 display(OLED_ANIM_WIDTH, OLED_ANIM_HEIGHT, &Wire, OLED_RESET);
static uint8_t frameBuffer[OLED_ANIM_BYTES_PER_FRAME];

void loadFrame(uint16_t frame) {
  uint32_t off=pgm_read_dword(&OLED_ANIM_OFFSETS[frame]);
  uint32_t len=pgm_read_dword(&OLED_ANIM_LENGTHS[frame]);
  uint8_t raw=pgm_read_byte(&OLED_ANIM_RAW[frame]);
  if(raw){ memcpy_P(frameBuffer, OLED_ANIM_DATA+off, OLED_ANIM_BYTES_PER_FRAME); return; }
  uint32_t p=0,out=0;
  while(out<OLED_ANIM_BYTES_PER_FRAME && p+1<len){
    uint8_t count=pgm_read_byte(&OLED_ANIM_DATA[off+p++]);
    uint8_t value=pgm_read_byte(&OLED_ANIM_DATA[off+p++]);
    for(uint16_t n=0;n<count && out<OLED_ANIM_BYTES_PER_FRAME;n++) frameBuffer[out++]=value;
  }
}

void playAnimation(){
  for(uint16_t frame=0;frame<OLED_ANIM_FRAME_COUNT;frame++){
    loadFrame(frame);
    display.clearDisplay();
    display.drawBitmap(0,0,frameBuffer,OLED_ANIM_WIDTH,OLED_ANIM_HEIGHT,SSD1306_WHITE);
    display.display();
    delay(pgm_read_word(&OLED_ANIM_DELAYS[frame]));
  }
}

void setup(){
  Wire.begin(21,22);
  if(!display.begin(SSD1306_SWITCHCAPVCC,OLED_ADDRESS)) while(true) delay(1000);
  display.clearDisplay();
  display.display();
}

void loop(){
  playAnimation();
  ${loopOn?'':'while(true) delay(1000);'}
}
`;
}

function opts(body,duration) {
  const width=Number(body.width||128), height=Number(body.height||64);
  if(!ALLOWED_WIDTHS.has(width)||!ALLOWED_HEIGHTS.has(height)) throw new Error('Only 128×64 and 128×32 are supported.');
  const start=Math.max(0,Number(body.start||0)), end=Math.min(duration,Number(body.end ?? duration));
  if(!(end>start)) throw new Error('Invalid start/end range.');
  if(end-start>MAX_DURATION_SECONDS) throw new Error('Maximum processor clip is 10 minutes in this prototype.');
  return {
    width,height,start,end,
    fps:n(body.fps,6,.5,15),
    threshold:n(body.threshold,128,0,255),
    brightness:n(body.brightness,0,-100,100),
    contrast:n(body.contrast,100,0,200)/100,
    dither:['off','ordered','floyd'].includes(body.dither)?body.dither:'ordered',
    invert:Boolean(body.invert),
    dedupe:body.dedupe!==false,
    compression:body.compression!==false,
    loop:body.loop!==false,
    fit:['contain','cover','stretch'].includes(body.fit)?body.fit:'cover'
  };
}

function filterFor(o) {
  const scale=o.fit==='stretch'
    ? `scale=${o.width}:${o.height}`
    : o.fit==='contain'
      ? `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:black`
      : `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height}`;
  return `${scale},fps=${o.fps},format=gray`;
}

async function processFrames(url,o,maxFrames=Infinity) {
  const input=await playableUrl(url);
  const grayBytes=o.width*o.height;
  const sampleCount=Math.max(1,Math.ceil((o.end-o.start)*o.fps));
  const p=spawn('ffmpeg',[
    '-hide_banner','-loglevel','error','-ss',String(o.start),'-i',input,
    '-t',String(o.end-o.start),'-vf',filterFor(o),
    '-f','rawvideo','-pix_fmt','gray','pipe:1'
  ],{stdio:['ignore','pipe','pipe']});
  let stderr='',pending=Buffer.alloc(0),processed=0;
  const frames=[],delays=[];
  p.stderr.on('data',d=>{if(stderr.length<50000)stderr+=d.toString()});
  for await(const chunk of p.stdout){
    pending=Buffer.concat([pending,chunk]);
    while(pending.length>=grayBytes && processed<sampleCount && frames.length<maxFrames){
      const gray=pending.subarray(0,grayBytes); pending=pending.subarray(grayBytes);
      const frame=packedFrame(gray,o.width,o.height,o), delay=Math.max(20,Math.round(1000/o.fps));
      if(o.dedupe && frames.length && same(frames.at(-1),frame)) delays[delays.length-1]+=delay;
      else {frames.push(frame);delays.push(delay);}
      processed++;
    }
    if(frames.length>=maxFrames)p.kill('SIGTERM');
  }
  const [code]=await once(p,'close');
  if(code && frames.length===0) throw new Error(stderr.trim()||'ffmpeg failed.');
  return {frames,delays,sampleCount};
}

app.get('/health',(_req,res)=>res.json({ok:true,service:'oledframe-processor',version:'0.1.0'}));

app.post('/api/info',async(req,res)=>{
  try { res.json({ok:true,...await infoFor(req.body?.url)}); }
  catch(e){ res.status(400).json({ok:false,error:e.message}); }
});

app.post('/api/convert',async(req,res)=>{
  try {
    const info=await infoFor(req.body?.url);
    const o=opts(req.body,info.duration);
    const result=await processFrames(req.body.url,o);
    if(!result.frames.length) throw new Error('No frames were produced.');
    const header=buildHeader(result.frames,result.delays,o.width,o.height,o.compression);
    const sketch=buildSketch(o.width,o.height,o.loop);
    const readme=`ESP32 OLED Animation Project

Source: ${info.title}
Clip: ${o.start.toFixed(2)}s -> ${o.end.toFixed(2)}s
Frames: ${result.frames.length}
FPS: ${o.fps}
Resolution: ${o.width}x${o.height}

Hardware
--------
ESP32 + SSD1306
SDA -> GPIO 21
SCL -> GPIO 22
I2C address -> 0x3C

Libraries
---------
Adafruit GFX Library
Adafruit SSD1306

Open ESP32_OLED_Animation.ino in Arduino IDE, install the libraries above, select your ESP32 board, then upload.
`;
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Disposition','attachment; filename="ESP32_OLED_Animation.zip"');
    const archive=archiver('zip',{zlib:{level:6}});
    archive.on('error',e=>res.destroy(e));
    archive.pipe(res);
    archive.append(sketch,{name:'ESP32_OLED_Animation/ESP32_OLED_Animation.ino'});
    archive.append(header,{name:'ESP32_OLED_Animation/animation.h'});
    archive.append(readme,{name:'ESP32_OLED_Animation/README.txt'});
    await archive.finalize();
  } catch(e) {
    if(!res.headersSent) res.status(400).json({ok:false,error:e.message});
    else res.destroy(e);
  }
});

app.listen(PORT,'0.0.0.0',()=>console.log('OLEDFrame processor listening on '+PORT));
