// The sidebar modules are maintained in JavaScript alongside the TypeScript sources.
// Keep the installable output synchronized on every build.
const fs = require("node:fs");
const path = require("node:path");
for (const file of ["sidebarChatView.js", "sidebarChatBackend.js", "toolPresentation.js"]) {
  fs.copyFileSync(path.join(__dirname, "..", "src", file), path.join(__dirname, "..", "dist", file));
}
