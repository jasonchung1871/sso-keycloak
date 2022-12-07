const { argv } = require('yargs');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const { getKeycloakAdminClient } = require('./util');

dotenv.config();

const { kcEnv, kcRealm, totp } = argv;

let pool = undefined;
let client = undefined;

async function cleanup() {
  console.log(`Cleaning up`);
  if (client !== undefined) await client.end();
  if (pool !== undefined) await pool.end();
}

async function main() {
  if (
    !kcEnv ||
    !kcRealm
  ) {
    console.info(`
    Usage:
      node add-guids --kc-env <env> --kc-realm <realm> [--totp <totp>]

    Flags:
      --kc-env             Base Keycloak environment. Available values: (dev, test, prod)
      --kc-realm           Base realm of the base Keycloak environment
      --totp                 Time-based One-time Password (TOTP) passed into the Keycloak auth call of the base environment; Optional
    `);
    return;
  }
  try {
    pool = new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: (kcEnv === 'prod') ? process.env.PROD_PGPASSWORD :  (kcEnv === 'test' ? process.env.TEST_PGPASSWORD : process.env.PGPASSWORD),
      database: process.env.PGDATABASE
    });

    client = await pool.connect();

    console.log(`Connected to the database.`);

    // const res = await pool.query('SELECT NOW()');

    const silverKcAdminClient = await getKeycloakAdminClient('silver', kcEnv, kcRealm, { totp });
    if (!silverKcAdminClient) return;

    console.log(`Connected to keycloak`);

    userReport = {
      'missing-guid': [],
      'updated': [],
    };

    const missingGuids = await client.query(`SELECT "keycloakId" from public.user WHERE "idpUserId" IS NULL OR "idpUserId"=''`);

    if (missingGuids.rowCount > 0) {
      console.log(`There are ${missingGuids.rowCount} missing guids`);
      for (let i = 0; i < missingGuids.rowCount; i++) {
        const kcId = missingGuids.rows[i].keycloakId;
        let targetUser = await silverKcAdminClient.users.findOne({
          id: kcId,
        });
        if (targetUser) {
          const guid = getGuid(targetUser);
          if (guid === '') {
            userReport['missing-guid'].push(targetUser);
            continue;
          }
          await client.query('UPDATE public.user SET "idpUserId"=$1 WHERE "keycloakId"=$2', [guid, kcId]);
          userReport['updated'].push(targetUser);
        }
      }
    }

    console.log(userReport);
  } catch (ex) {
    console.error(ex);
  }

  cleanup();
}

main();


const getGuid = (targetUser) => {
  if (!targetUser.attributes) return '';

  if (targetUser.attributes.idir_userid) return targetUser.attributes.idir_userid[0];
  if (targetUser.attributes.bceid_userid) return targetUser.attributes.bceid_userid[0];

  return '';
}
