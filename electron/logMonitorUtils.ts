import * as fs from "fs";
import * as readline from "readline";
import type { SpeakMessage } from "./parsers/claudeCodeParser";

export const DEBOUNCE_MS = 100;
export const RESCAN_INTERVAL_MS = 30_000;

export type BroadcastFn = (message: string) => void;

export function initializeFilePosition(positions: Map<string, number>, filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    positions.set(filePath, stats.size);
  } catch {
    positions.set(filePath, 0);
  }
}

export function skipFileChanges(positions: Map<string, number>, filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    positions.set(filePath, stats.size);
  } catch {
    // ignore
  }
}

export async function readNewLines(filePath: string, start: number, end: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const stream = fs.createReadStream(filePath, { start, end: end - 1, encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => { if (line.trim()) lines.push(line); });
    rl.on("close", () => resolve(lines));
    rl.on("error", reject);
  });
}

export async function processFileChanges(
  filePath: string,
  positions: Map<string, number>,
  lastProcessed: Map<string, number>,
  parseLog: (line: string) => SpeakMessage[],
  broadcast: BroadcastFn,
  label: string,
): Promise<void> {
  const now = Date.now();
  if (now - (lastProcessed.get(filePath) ?? 0) < DEBOUNCE_MS) return;
  lastProcessed.set(filePath, now);

  const startPosition = positions.get(filePath) ?? 0;

  try {
    const stats = fs.statSync(filePath);
    const currentSize = stats.size;

    if (currentSize < startPosition) { positions.set(filePath, currentSize); return; }
    if (currentSize === startPosition) return;

    const lines = await readNewLines(filePath, startPosition, currentSize);
    positions.set(filePath, currentSize);

    for (const line of lines) {
      for (const msg of parseLog(line)) {
        if (!msg.emotion) continue;
        console.log(`[${label}] Notification: emotion=${msg.emotion}`);
        broadcast(JSON.stringify(msg));
      }
    }
  } catch (err) {
    console.error(`[${label}] Error processing ${filePath}:`, err);
  }
}
