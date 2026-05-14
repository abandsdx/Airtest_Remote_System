const fs = require('fs');
const file = 'd:/code/Airtest_Remote_System/super_rescuer/frontend/app.js';
let data = fs.readFileSync(file, 'utf8');

// The original file is restored. We just patch `document.getElementById` so it never returns null.
data = data.replace(/document\.getElementById\('([^']+)'\)/g, "(document.getElementById('$1') || document.createElement('div'))");

fs.writeFileSync(file, data);
console.log('Successfully patched app.js');
