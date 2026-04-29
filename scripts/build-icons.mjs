import sharp from "sharp";
import png2icons from "png2icons";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconsDir = join(root, "resources", "icons");

const svgPath = join(iconsDir, "icon.svg");
const svgBuffer = readFileSync(svgPath);

console.log("Generating icon.png (1024x1024)...");
const pngBuffer = await sharp(svgBuffer).resize(1024, 1024).png().toBuffer();
writeFileSync(join(iconsDir, "icon.png"), pngBuffer);

console.log("Generating icon.ico (Windows)...");
const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BICUBIC, 0, true);
writeFileSync(join(iconsDir, "icon.ico"), icoBuffer);

console.log("Generating icon.icns (macOS)...");
const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC, 0);
writeFileSync(join(iconsDir, "icon.icns"), icnsBuffer);

console.log("Generating tray icons...");
const tray22 = await sharp(svgBuffer).resize(22, 22).png().toBuffer();
writeFileSync(join(iconsDir, "tray.png"), tray22);
const tray44 = await sharp(svgBuffer).resize(44, 44).png().toBuffer();
writeFileSync(join(iconsDir, "trayTemplate@2x.png"), tray44);
// trayTemplate (for macOS menu bar, template image should be monochrome)
// Using the same image; macOS will apply template rendering automatically
writeFileSync(join(iconsDir, "trayTemplate.png"), tray22);

console.log("Done.");
