import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Placeholder photo for SAMPLE readings and tests: a 640×480 PNG clearly labelled "SAMPLE PHOTO".
export const SAMPLE_PHOTO_PNG = readFileSync(fileURLToPath(new URL("./sample-meter.png", import.meta.url)));
