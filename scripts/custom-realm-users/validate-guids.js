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
      node validate-guids --kc-env <env> --kc-realm <realm> [--totp <totp>]

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

    const silverKcAdminClient = await getKeycloakAdminClient('silver', kcEnv, kcRealm, { totp });
    if (!silverKcAdminClient) return;

    console.log(`Connected to keycloak`);

    userReport = {
      'valid': [],
      'mismatch-guid': [],
    };

    const guids = await client.query('SELECT "keycloakId","idpUserId" from public.user WHERE "idpUserId" IS NOT NULL');

    if (guids.rowCount > 0) {
      for (let i = 0; i < guids.rowCount; i++) {
        const kcId = guids.rows[i].keycloakId;
        const idpUserId = guids.rows[i].idpUserId;
        let targetUser = await silverKcAdminClient.users.findOne({
          id: kcId,
        });
        if (targetUser) {
          const guid = getGuid(targetUser);
          if (idpUserId != guid) {
            userReport['mismatch-guid'].push(targetUser);
          } else {
            userReport['valid'].push(targetUser);
          }
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
