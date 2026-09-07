const fs = require('fs');
const path = require('path');

function getFiles(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isFile()) files.push(fullPath);
    else if (item.isDirectory()) files.push(...getFiles(fullPath));
  }
  return files;
}

function relativePath(absPath) {
  return path.relative('.', absPath).replace(/\\/g, '/');
}

const files = [
  ...getFiles('src-tauri/src'),
  ...getFiles('src').filter(f => /\.(ts|tsx|css|scss)$/.test(f))
];

let output = '';
for (const file of files.sort()) {
  const rel = relativePath(file);
  const content = fs.readFileSync(file, 'utf8');
  output += `# ${rel}\n\`\`\`\n${content}\`\`\`\n\n`;
}

fs.writeFileSync('code_source.md', output.trim() + '\n');
console.log('✅ code_source.md mis à jour avec ' + files.length + ' fichiers');
