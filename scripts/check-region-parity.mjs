import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const regions = ['ap-southeast-1', 'ap-northeast-1'];
const configs = await Promise.all(regions.map(async region => JSON.parse(await readFile(new URL(`../config/demo/${region}.json`, import.meta.url), 'utf8'))));
let differences = 0;
for (const key of ['api', 'dashboard', 'authorizer', 'monitoring']) {
  const results = configs.map(config => JSON.parse(execFileSync('aws', [
    'lambda', 'get-function-configuration', '--function-name', config.functions[key],
    '--region', config.region, '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', windowsHide: true })));
  for (const field of ['CodeSha256', 'Runtime', 'Handler', 'MemorySize', 'Timeout', 'Role']) {
    const same = results[0][field] === results[1][field];
    console.log(`${key} ${field}: ${same ? 'MATCH' : 'DIFFERENT'}`);
    if (!same) differences++;
  }
  const envs = results.map(result => result.Environment?.Variables ?? {});
  for (const field of new Set(envs.flatMap(env => Object.keys(env)))) {
    const same = envs[0][field] === envs[1][field];
    console.log(`${key} env ${field}: ${same ? 'MATCH' : 'DIFFERENT'}`);
    if (!same) differences++;
  }
}
console.log('Chỉ so sánh Lambda; API routes/authorizer/stage phải kiểm tra riêng.');
process.exitCode = differences ? 1 : 0;
