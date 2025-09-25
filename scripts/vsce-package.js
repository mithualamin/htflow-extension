#!/usr/bin/env node
const undici = require('undici');
if (!global.File && undici.File) {
  global.File = undici.File;
}
require('@vscode/vsce/out/main')(process.argv);
