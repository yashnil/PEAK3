import fs from "fs";
const log = JSON.parse(fs.readFileSync(process.argv[2] + "/log.json", "utf8"));
const seq = log.filter(e => ["phase","roundCard","rollStage","overlay","moment","beat","overlayBeat","lock","podium"].includes(e.k));
// round card durations
let open = null; const cards = [];
for (const e of seq) { if (e.k === "roundCard") { if (e.v) open = e.t; else if (open !== null) { cards.push(e.t - open); open = null; } } }
console.log("round card visible ms:", cards);
// roll stage timeline per reveal
let stageStart = {}; const holds = []; let resolvedAt = null; let lockAt = null; const locks = [];
for (const e of seq) {
  if (e.k === "rollStage") { if (e.v === "locked") lockAt = e.t; if (e.v === "resolved") { resolvedAt = e.t; if (lockAt) locks.push(e.t - lockAt); } }
  if (e.k === "overlay" && e.v === true && resolvedAt !== null) { holds.push(e.t - resolvedAt); resolvedAt = null; }
  if (e.k === "phase" && e.v === "pick" && resolvedAt !== null) { /* phase flipped */ }
}
console.log("lock beat ms:", locks);
console.log("resolved -> overlay open (hold) ms:", holds);
// previous pick -> overlay: lock text length grows (a pick landed) then overlay opens
let lastLock = null; const handoffs = [];
for (const e of seq) {
  if (e.k === "lock") lastLock = e.t;
  if (e.k === "overlay" && e.v === true && lastLock !== null) { handoffs.push(e.t - lastLock); lastLock = null; }
}
console.log("pick landed (lock text change) -> overlay open ms:", handoffs);
console.log("--- timeline");
for (const e of seq) console.log(e.t, e.k, JSON.stringify(e.v).slice(0, 80));
