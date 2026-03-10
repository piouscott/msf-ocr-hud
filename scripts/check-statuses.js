const d = require("../data/characters-full.json");
const s = {};
Object.entries(d.characters).forEach(([id, c]) => {
  const st = c.status || "?";
  if (s[st] === undefined) s[st] = [];
  s[st].push(id);
});
Object.entries(s).forEach(([k, v]) => {
  console.log(k + ": " + v.length);
  if (k !== "playable") console.log("  " + v.join(", "));
});
