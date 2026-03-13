import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { app } from '../apps/api/src/index';

const targetArg = Bun.argv[2] || 'apps/miniprogram/.openapi/openapi.json';
const targetPath = resolve(process.cwd(), targetArg);

async function exportOpenApi() {
  const response = await app.handle(new Request('http://localhost/openapi/json'));

  if (!response.ok) {
    throw new Error(`导出 OpenAPI 失败: HTTP ${response.status}`);
  }

  const spec = await response.text();
  await mkdir(dirname(targetPath), { recursive: true });
  await Bun.write(targetPath, spec);
  console.log(`OpenAPI 已导出到 ${targetPath}`);
}

exportOpenApi().catch((error) => {
  console.error(error);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
