import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

// Deliberately opt-in: local checks never contact a real AWS account.
const profile = process.env.AWS_PROFILE;
const region = process.env.AWS_REGION;
if (!profile || !region) throw new Error('Set AWS_PROFILE and AWS_REGION to the explicitly chosen AWS target.');
const timestamp = new Date().toISOString();
const actor = process.env.EVIDENCE_ACTOR || 'unspecified operator';
const base = { timestamp, actor, profile, region, operation: 'sts:GetCallerIdentity', read_only: true };
mkdirSync('evidence', { recursive: true });
const filename = `evidence/aws-connection-${timestamp.replace(/[:.]/g, '-')}.json`;
try {
  const result = JSON.parse(execFileSync('aws', [
    '--profile', profile, '--region', region, '--no-cli-pager', 'sts', 'get-caller-identity', '--output', 'json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const evidence = { ...base, status: 'verified',
    identity_sha256: createHash('sha256').update(`${result.Account}:${result.Arn}`).digest('hex'),
    account_suffix: String(result.Account).slice(-4),
    note: 'Authenticated read-only AWS connection; not proof of deployment or competition eligibility.',
  };
  writeFileSync(filename, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Saved sanitized AWS connection evidence to ${filename}`);
} catch {
  writeFileSync(filename, JSON.stringify({ ...base, status: 'failed', note: 'No successful AWS identity response.' }, null, 2) + '\n');
  console.error(`AWS connection could not be verified; failure recorded at ${filename}.`);
  process.exitCode = 1;
}
