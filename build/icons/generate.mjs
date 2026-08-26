import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = here;

// Icon spec: matches reference image — dark rounded square #1A1E26, green #12B981
const BG = "#1A1E26";
const GREEN = "#12B981";
// Draw function for a given size
function drawIcon(ctx, N) {
  const w = N, h = N;
  ctx.clearRect(0,0,w,h);
  // outer rounded rect
  const pad = Math.round(N * 0.0469); // 48/1024
  const rr = Math.round(N * 0.156); // 160/1024
  const rw = w - pad*2, rh = h - pad*2;
  roundedRect(ctx, pad, pad, rw, rh, rr);
  ctx.fillStyle = BG;
  ctx.fill();

  // gauge arc
  const cx = w * 0.5;
  const cy = h * 0.52; // approx 532/1024
  const arcR = w * 0.332; // 340/1024
  const strokeW = w * 0.080; // 82
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = strokeW;
  ctx.lineCap = "round";
  ctx.beginPath();
  // arc from ~195deg to 345deg (covers ~150deg semicircle + extra)
  // In image arc starts left lower (~200deg) ends right lower (~360-10)
  const start = (195 * Math.PI)/180;
  const end = (345 * Math.PI)/180;
  ctx.arc(cx, cy, arcR, start, end, false);
  ctx.stroke();

  // ticks — 5 ticks along arc, as small dark rectangles on top of green
  ctx.fillStyle = BG;
  const ticks = [-52, -32, 0, 32, 52]; // degrees offset from vertical
  for (const deg of ticks) {
    const ang = (-90 + deg) * Math.PI/180; // -90 is top
    const r = arcR;
    const tx = cx + Math.cos(ang) * r;
    const ty = cy + Math.sin(ang) * r;
    const tw = w * 0.0215;
    const th = w * 0.0508;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(ang + Math.PI/2);
    // rounded rect
    roundedRect(ctx, -tw/2, -th/2, tw, th, Math.max(2, w*0.003));
    ctx.fill();
    ctx.restore();
  }

  // needle base square
  const baseSize = w * 0.086; // 88/1024
  const baseX = cx - baseSize/2;
  const baseY = cy - baseSize*0.28; // slightly above center
  const baseR = w * 0.0137;
  roundedRect(ctx, baseX, baseY, baseSize, baseSize, baseR);
  ctx.fillStyle = GREEN;
  ctx.fill();

  // needle — pointing ~48deg from vertical (toward ~1:30, overlapping arc)
  const needleLen = w * 0.28;
  const needleAng = (-90 + 58) * Math.PI/180; // 58deg to the right of top
  const tipX = cx + Math.cos(needleAng) * (arcR - strokeW*0.35);
  const tipY = cy + Math.sin(needleAng) * (arcR - strokeW*0.35);
  const baseCX = cx;
  const baseCY = baseY + baseSize*0.5;
  // needle as thick line with width tapering? In image needle is wide at base, pointed at tip
  // Draw as polygon: base width ~22, tip width 4
  const halfBase = w * 0.014;
  const perp = needleAng + Math.PI/2;
  const bx1 = baseCX + Math.cos(perp)* halfBase;
  const by1 = baseCY + Math.sin(perp)* halfBase;
  const bx2 = baseCX - Math.cos(perp)* halfBase;
  const by2 = baseCY - Math.sin(perp)* halfBase;
  ctx.beginPath();
  ctx.moveTo(bx1, by1);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(bx2, by2);
  ctx.closePath();
  ctx.fillStyle = GREEN;
  ctx.fill();
  // white outline around tip to mimic highlight? In image tip has dark gap
  // add small circle at tip with BG border
  ctx.beginPath();
  ctx.arc(tipX, tipY, w*0.0176, 0, Math.PI*2);
  ctx.fillStyle = GREEN;
  ctx.fill();
  ctx.strokeStyle = BG;
  ctx.lineWidth = Math.max(2, w*0.006);
  ctx.stroke();

  // text LLMTab
  ctx.fillStyle = GREEN;
  const fontSize = w * 0.148; // 152/1024
  ctx.font = `800 ${Math.round(fontSize)}px Inter, "SF Pro Display", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // letter-spacing -2 at 1024 -> approximate by manual
  ctx.fillText("LLMTab", cx, h * 0.781 + fontSize*0.08);
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function drawIconSmall(ctx, N) {
  // For 16/32: no text, larger gauge for legibility
  const w = N, h = N;
  ctx.clearRect(0,0,w,h);
  const pad = Math.round(N * 0.10);
  const rr = Math.round(N * 0.22);
  const rw = w - pad*2, rh = h - pad*2;
  roundedRect(ctx, pad, pad, rw, rh, rr);
  ctx.fillStyle = BG;
  ctx.fill();
  const cx = w*0.5, cy = h*0.54;
  const arcR = w*0.30;
  const strokeW = w*0.10;
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = strokeW;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, (195*Math.PI/180), (345*Math.PI/180));
  ctx.stroke();
  // needle simplified
  const needleAng = (-90+58)*Math.PI/180;
  const tipX = cx + Math.cos(needleAng)*(arcR - strokeW*0.25);
  const tipY = cy + Math.sin(needleAng)*(arcR - strokeW*0.25);
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(cx, cy-1, w*0.09, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = Math.max(2, w*0.07);
  ctx.lineCap = "round";
  ctx.stroke();
}

function writePNG(size, file) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (size <= 32) drawIconSmall(ctx, size);
  else drawIcon(ctx, size);
  const buf = canvas.toBuffer("image/png");
  fs.writeFileSync(file, buf);
  console.log(`wrote ${file} (${size}x${size} ${buf.length}b)`);
}

// Generate app icons
for (const s of [16,32,48,64,128,256,512,1024]) {
  writePNG(s, path.join(OUT, `icon-${s}.png`));
}
// also icon.png 512 as default
fs.copyFileSync(path.join(OUT, "icon-512.png"), path.join(OUT, "icon.png"));

// Tray template (monochrome white on transparent, 16/32, icon-only without text/bg)
// For template, draw only gauge + needle in white, centered, no background square
function drawTray(ctx, N) {
  ctx.clearRect(0,0,N,N);
  ctx.fillStyle = "#ffffff";
  const cx = N*0.5, cy = N*0.55;
  const arcR = N*0.38;
  const strokeW = N*0.13;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = strokeW;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, (195*Math.PI/180), (345*Math.PI/180));
  ctx.stroke();
  // ticks as cutouts? For monochrome we skip ticks (keep simple) or draw as gaps
  // needle
  const needleAng = (-90+58)*Math.PI/180;
  const tipX = cx + Math.cos(needleAng)*(arcR - strokeW*0.3);
  const tipY = cy + Math.sin(needleAng)*(arcR - strokeW*0.3);
  ctx.beginPath();
  ctx.moveTo(cx-1, cy-1);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(cx+1, cy-1);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  // base dot
  ctx.beginPath();
  ctx.arc(cx, cy, N*0.09, 0, Math.PI*2);
  ctx.fill();
}

function writeTray(size, file) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  drawTray(ctx, size);
  const buf = canvas.toBuffer("image/png");
  fs.writeFileSync(file, buf);
  console.log(`wrote ${file}`);
}
writeTray(16, path.join(OUT, "tray-16.png"));
writeTray(32, path.join(OUT, "tray-32.png"));
writeTray(18, path.join(OUT, "tray-18.png"));

// Favicon 32
fs.copyFileSync(path.join(OUT, "icon-32.png"), path.join(OUT, "favicon-32.png"));
fs.copyFileSync(path.join(OUT, "icon-16.png"), path.join(OUT, "favicon-16.png"));

console.log("done");
