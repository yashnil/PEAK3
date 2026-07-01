#!/usr/bin/env node
/**
 * Kill processes occupying ports 3000 and 8000 before a fresh E2E run.
 * Safe to run when ports are already clear.
 */
"use strict";
const { execSync, spawnSync } = require("child_process");

const PORTS = [3000, 8000];

for (const port of PORTS) {
  try {
    const raw = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
    if (!raw) continue;
    const pids = raw.split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`[kill-ports] terminated PID ${pid} (port ${port})`);
      } catch {
        // process already gone — not an error
      }
    }
  } catch {
    // lsof returned nothing — port already clear
  }
}

// 500 ms grace for graceful shutdown before Playwright starts its own servers
spawnSync("sleep", ["0.5"]);
console.log("[kill-ports] ports 3000 and 8000 cleared");
