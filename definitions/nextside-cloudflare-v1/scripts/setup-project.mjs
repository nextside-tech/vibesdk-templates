import { readFile, writeFile } from 'node:fs/promises';

const [target, name] = process.argv.slice(2);
if (!target || !name) {
  console.error('usage: setup-project.mjs <target> <name>');
  process.exit(64);
}

const packagePath = `${target}/package.json`;
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
packageJson.name = name;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const wranglerPath = `${target}/wrangler.jsonc`;
const wrangler = await readFile(wranglerPath, 'utf8');
await writeFile(
  wranglerPath,
  wrangler.replace('"name": "nextside-cloudflare-v1"', `"name": "${name}"`),
);
