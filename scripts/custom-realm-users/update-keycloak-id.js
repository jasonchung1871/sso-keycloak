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
      node update-keycloak-ids --kc-env <env> --kc-realm <realm> [--totp <totp>]

    Flags:
      --kc-env             Base Keycloak environment. Available values: (dev, test, prod)
      --kc-realm           Base realm of the base Keycloak environment
      --totp                 Time-based One-time Password (TOTP) passed into the Keycloak auth call of the base environment; Optional
    `);
    return;
  }
  try {
    pool = new Pool({
      host: process.env[`${kcEnv.toUpperCase()}_PGHOST`],
      port: process.env[`${kcEnv.toUpperCase()}_PGPORT`],
      user: process.env[`${kcEnv.toUpperCase()}_PGUSER`],
      password: process.env[`${kcEnv.toUpperCase()}_PGPASSWORD`],
      database: process.env[`${kcEnv.toUpperCase()}_PGDATABASE`]
    });

    client = await pool.connect();

    console.log(`Connected to the database.`);

    const goldKcAdminClient = await getKeycloakAdminClient('gold', kcEnv, kcRealm, { totp });
    if (goldKcAdminClient) return;

    console.log(`Connected to keycloak`);

    userReport = {
      'failed': [],
      'updated': [],
    };

    const usersToUpdate = await client.query(`SELECT "idpUserId","idpCode" from public.user WHERE "idpUserId" IS NOT NULL`);

    if (usersToUpdate.rowCount > 0) {
      console.log(`There are ${usersToUpdate.rowCount} users`);
      for (let i = 0; i < usersToUpdate.rowCount; i++) {
        const idpUserId = usersToUpdate.rows[i].idpUserId;
        const idpCode = usersToUpdate.rows[i].idpCode;
        let searchParams = {};
        searchParams[(idpCode == 'idir' ? 'idir_userid' : 'bceid_userid')] = idpUserId;
        let targetUser = await goldKcAdminClient.users.findOne(searchParams);
        console.log(searchParams);
        console.log(targetUser.length);
        if (targetUser && targetUser.length === 1) {
          console.log(targetUser['id']);
          await client.query('UPDATE public.user SET "keycloakId"=$1 WHERE "idpUserId"=$2', [targetUser['id'], idpUserId]);
          userReport['updated'].push(targetUser);
        } else {
          userReport['failed'].push(idpUserId);
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
