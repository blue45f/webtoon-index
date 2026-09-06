#!/usr/bin/env node
/** Creates accounts ONLY in an explicitly opted-in, empty, loopback QA database.
 * Does not create/migrate a schema, load .env files, reset users, or contact email.
 * Default is dry-run. Actual execution requires the repository's pg + tsx packages.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED_CONFIRMATION = 'CREATE-ISOLATED-ADMIN-QA-ACCOUNTS';
export const QA_ROLES = Object.freeze(['admin', 'operator', 'creator', 'user']);
export const QA_STATUSES = Object.freeze(['active', 'suspended', 'deleted']);
const DATABASE_NAME = /^toonspectrum_admin_(?:qa|test)(?:_[a-z0-9]+)?$/u;
const INSERT_USER = `INSERT INTO "user"
  (id, name, email, role, status, "passwordHash", "sessionVersion", "emailVerified",
   "suspendedAt", "suspensionReason", "deletedAt", "createdAt")
  VALUES ($1,$2,$3,$4,$5,$6,1,now(),
    CASE WHEN $5='suspended' THEN now() ELSE NULL END,
    CASE WHEN $5='suspended' THEN 'isolated admin QA fixture' ELSE NULL END,
    CASE WHEN $5='deleted' THEN now() ELSE NULL END, now())`;

/** Pure validation; does not resolve DNS or establish any connections. */
export function validateAdminQaTarget(environment = process.env) { // NOSONAR javascript:S3776
  if (environment.NODE_ENV !== 'test') throw new Error('NODE_ENV=test is required.');
  for (const key of ['VERCEL_ENV', 'VERCEL_TARGET_ENV', 'CONTEXT', 'RAILWAY_ENVIRONMENT_NAME']) {
    if (String(environment[key] ?? '').trim().toLowerCase() === 'production') {
      throw new Error('Production execution is forbidden.');
    }
  }
  if (environment.RENDER_SERVICE_ID) throw new Error('Managed production/service runtimes are forbidden.');
  const raw = environment.TEST_DATABASE_URL;
  if (!raw || typeof raw !== 'string') throw new Error('Explicit TEST_DATABASE_URL is required.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid QA database URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || !url.username || !url.password || url.search || url.hash
      || !url.port || Number(url.port) < 1024 || Number(url.port) > 65535) {
    throw new Error('Only credentialed literal-loopback PostgreSQL with an explicit port and no URL parameters is allowed.');
  }
  let name;
  try { name = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Error('Invalid database name.'); }
  if (!DATABASE_NAME.test(name)) throw new Error('Use a dedicated toonspectrum_admin_qa or toonspectrum_admin_test database.');
  if (environment.DATABASE_URL && environment.DATABASE_URL !== raw) {
    throw new Error('Refusing conflicting DATABASE_URL; unset it or match TEST_DATABASE_URL explicitly.');
  }
  if (environment.TOONSPECTRUM_ADMIN_QA_SEED !== '1') throw new Error('TOONSPECTRUM_ADMIN_QA_SEED=1 is required.');
  return Object.freeze({ connectionString: raw, databaseName: name, host: url.hostname });
}

/** Public manifest does not generate or expose passwords. */
export function buildAdminQaPlan(runId = `adminqa-${randomBytes(8).toString('hex')}`) {
  if (!/^adminqa-[a-z0-9]{8,40}$/u.test(runId)) throw new Error('Invalid QA run id.');
  const specs = QA_ROLES.flatMap(role => QA_STATUSES.map(status => ({key:`${role}-${status}`,role,status})));
  specs.push({key:'mutation-target',role:'user',status:'active'});
  return Object.freeze({runId, accounts: specs.map(spec => Object.freeze({
    ...spec, id:randomUUID(), email:`${spec.key}.${runId}@example.invalid`,
    name:`[QA ${runId}] ${spec.key}`,
  }))});
}

export function addRandomCredentials(plan) {
  return {...plan, accounts:plan.accounts.map(account=>({...account,
    // Tombstones intentionally have no reusable credential.
    password:account.status==='deleted'?null:`Qa!${randomBytes(32).toString('base64url')}`,
  }))};
}

/** Execute inside one transaction. The supplied client must use the validated target.
 * Empty-user-table check prevents changing/reusing an existing installation. */
export async function insertAdminQaAccounts({client,target,plan,hashPassword,writeManifest}) {
  if (!DATABASE_NAME.test(target.databaseName)) throw new Error('Invalid QA target.');
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query('SET LOCAL search_path = public, pg_catalog');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('toonspectrum-admin-qa-seed'))");
    const result=await client.query('SELECT current_database() AS name, (SELECT count(*)::int FROM "user") AS users');
    if (result.rows[0]?.name !== target.databaseName || Number(result.rows[0]?.users) !== 0) {
      throw new Error('The dedicated QA database must exist, match the requested name, and have no users. No existing users were modified.');
    }
    for (const account of plan.accounts) {
      const hash=account.password===null?null:hashPassword(account.password);
      await client.query(INSERT_USER,[account.id,account.name,account.email,account.role,account.status,hash]);
    }
    // Fail/rollback rather than create privileged accounts with lost credentials.
    await writeManifest(plan);
    await client.query('COMMIT');
    return {created:plan.accounts.length,runId:plan.runId,verifiedLogins:0};
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }
}

export async function writePrivateManifest(filename, manifest) {
  const file=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {
    await file.writeFile(JSON.stringify({kind:'toonspectrum-admin-qa-credentials-v1',...manifest},null,2)+'\n');
    await file.sync();
  } finally { await file.close(); }
}

export function parseSeedArguments(args) { // NOSONAR javascript:S3776
  let execute=false,dryRun=false,confirmation='',output='';
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--execute'&&!execute)execute=true;
    else if(arg==='--dry-run'&&!dryRun)dryRun=true;
    else if(arg==='--confirm'&&!confirmation)confirmation=args[++i]??''; // NOSONAR javascript:S2310
    else if(arg==='--out'&&!output)output=args[++i]??''; // NOSONAR javascript:S2310
    else throw new Error('Usage: [--dry-run] or --execute --confirm CREATE-ISOLATED-ADMIN-QA-ACCOUNTS --out <new-private-file.json>');
  }
  if(execute&&dryRun)throw new Error('--execute and --dry-run are mutually exclusive.');
  if(execute&&(confirmation!==SEED_CONFIRMATION||!output))throw new Error('Explicit confirmation and a new private output file are required.');
  return {execute,output};
}

async function main() {
  const options=parseSeedArguments(process.argv.slice(2));
  const target=validateAdminQaTarget();
  const plan=buildAdminQaPlan();
  if(!options.execute) {
    console.log(JSON.stringify({mode:'dry-run',database:target.databaseName,accountCount:plan.accounts.length,...plan,
      created:0,verifiedLogins:0},null,2));
    return;
  }
  // Keep privileged QA credentials outside the checkout so they cannot be
  // accidentally staged, even if the project's ignore rules change.
  const repo=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
  const output=resolve(options.output);
  const parent=await realpath(dirname(output));
  const rel=relative(repo,parent);
  if(rel===''||(!rel.startsWith(`..${sep}`)&&rel!=='..'&&!rel.startsWith(sep))) {
    throw new Error('Credential output must be outside the repository checkout.');
  }
  // Import only after isolation checks; neither module loads an application DB singleton.
  const [{default:pg},{hashPassword}]=await Promise.all([import('pg'),import('../../apps/web/src/shared/lib/auth-crypto.ts')]);
  const client=new pg.Client({connectionString:target.connectionString,connectionTimeoutMillis:5_000,statement_timeout:10_000});
  await client.connect();
  try {
    const result=await insertAdminQaAccounts({client,target,plan:addRandomCredentials(plan),hashPassword,
      writeManifest:manifest=>writePrivateManifest(resolve(options.output),manifest)});
    console.log(JSON.stringify({...result,credentialFile:resolve(options.output)},null,2));
  } finally {await client.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{
    console.error('Admin QA seed did not complete. Check explicit test flags, a fresh loopback QA database, dependencies and the private output path. A partially written credential file is not proof of committed accounts.');
    process.exitCode=1;
  });
}
