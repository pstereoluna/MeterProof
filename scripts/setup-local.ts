import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

async function main() {
  const directory = resolve('.local/dynamodb');
  await mkdir(directory, { recursive: true });
  // Official distribution link from the AWS DynamoDB Local setup documentation.
  const source = 'https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz';
  const [archiveResponse, checksumResponse] = await Promise.all([fetch(source), fetch(`${source}.sha256`)]);
  if (!archiveResponse.ok || !checksumResponse.ok) throw new Error('DynamoDB Local download failed.');
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const checksum = (await checksumResponse.text()).trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== checksum) throw new Error('DynamoDB Local checksum did not match.');
  const path = resolve(directory, 'archive.tar.gz');
  await writeFile(path, archive);
  await writeFile(resolve(directory, 'archive.sha256'), `${actual}\n`);
  execFileSync('tar', ['-xzf', path, '-C', directory], { stdio: 'inherit' });
  console.log('DynamoDB Local downloaded and checksum verified. Run npm run db in a separate terminal.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
