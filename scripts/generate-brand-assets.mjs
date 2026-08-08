import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "assets/brand/branch-original-512.png");
const desktopFallback = path.join(root, "apps/desktop/src-tauri/icons/icon.png");

const readPng = (file) => PNG.sync.read(fs.readFileSync(file));
const writePng = (file, image) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(image, { colorType: 6 }));
};

// Bilinear scaling is intentionally deterministic: generated assets can always
// be recreated from the untouched 512 px cutout without an image model.
const resize = (source, width, height) => {
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sy = ((y + 0.5) * source.height) / height - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x += 1) {
      const sx = ((x + 0.5) * source.width) / width - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const out = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = source.data[(y0 * source.width + x0) * 4 + channel];
        const p10 = source.data[(y0 * source.width + x1) * 4 + channel];
        const p01 = source.data[(y1 * source.width + x0) * 4 + channel];
        const p11 = source.data[(y1 * source.width + x1) * 4 + channel];
        output.data[out + channel] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
            p01 * (1 - fx) * fy + p11 * fx * fy,
        );
      }
    }
  }
  return output;
};

const canvas = (size, pixel) => {
  const output = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const rgba = pixel(x, y);
      output.data[offset] = rgba[0];
      output.data[offset + 1] = rgba[1];
      output.data[offset + 2] = rgba[2];
      output.data[offset + 3] = rgba[3];
    }
  }
  return output;
};

const compositeCentered = (background, foreground, top) => {
  const left = Math.round((background.width - foreground.width) / 2);
  for (let y = 0; y < foreground.height; y += 1) {
    for (let x = 0; x < foreground.width; x += 1) {
      const src = (y * foreground.width + x) * 4;
      const dst = ((y + top) * background.width + x + left) * 4;
      const alpha = foreground.data[src + 3] / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        background.data[dst + channel] = Math.round(
          foreground.data[src + channel] * alpha +
            background.data[dst + channel] * (1 - alpha),
        );
      }
      background.data[dst + 3] = 255;
    }
  }
  return background;
};

if (!fs.existsSync(sourcePath)) {
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.copyFileSync(desktopFallback, sourcePath);
}

const source = readPng(sourcePath);
const splashMaster = resize(source, 1024, 1024);
writePng(path.join(root, "apps/desktop/public/type-splash-logo.png"), splashMaster);
writePng(path.join(root, "apps/mobile/assets/splash-icon.png"), splashMaster);
writePng(
  path.join(root, "apps/mobile/ios/Type/Images.xcassets/SplashScreen.imageset/splash.png"),
  splashMaster,
);

const iconSize = 1024;
const iconBranch = resize(source, 790, 790);
const iconBackground = canvas(iconSize, (x, y) => {
  const distance = Math.min(1, Math.hypot(x - 512, y - 460) / 720);
  return [
    Math.round(25 - distance * 7),
    Math.round(31 - distance * 8),
    Math.round(38 - distance * 8),
    255,
  ];
});
const mobileIcon = compositeCentered(iconBackground, iconBranch, 112);
writePng(path.join(root, "apps/mobile/assets/icon.png"), mobileIcon);
writePng(
  path.join(root, "apps/mobile/ios/Type/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"),
  mobileIcon,
);

// Android applies its own icon mask, so keep extra safe-zone padding.
const adaptiveBranch = resize(source, 620, 620);
const adaptive = new PNG({ width: iconSize, height: iconSize });
adaptive.data.fill(0);
adaptiveBranch.bitblt(adaptive, 0, 0, 620, 620, 202, 202);
writePng(path.join(root, "apps/mobile/assets/adaptive-icon.png"), adaptive);

console.log("Brand assets regenerated from assets/brand/branch-original-512.png");
