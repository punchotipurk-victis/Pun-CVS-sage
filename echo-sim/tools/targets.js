const PROBE = require(process.argv[2] + "/src/engine/probe.js"); global.PROBE = PROBE; const DERIVE = require(process.argv[2] + "/src/engine/derive.js");
const fs = require("fs"), ph = JSON.parse(fs.readFileSync(process.argv[3])), VJ = JSON.parse(fs.readFileSync(process.argv[4]));
for (const pos of ["supine", "LLD"]) { const T = DERIVE.derive(VJ, ph, pos); for (const [k, t] of Object.entries(T)) console.log(pos, k.padEnd(14), t.error || [t.x, t.y, t.notchDeg, t.tiltDeg, t.rockDeg].map(v => v.toFixed(1)).join(" "), t.inICS, t.ribPath?.toFixed(2)); }
