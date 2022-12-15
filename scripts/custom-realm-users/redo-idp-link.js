const { argv } = require('yargs');
const dotenv = require('dotenv');
const { getKeycloakAdminClient } = require('./util');

dotenv.config();

const { kcEnv, kcRealm, totp } = argv;
const baseRealmAliastoIdpMap = {};
const supportedEnvs = ['dev', 'test', 'prod'];

async function main() {
  if (
    !kcEnv ||
    !kcRealm ||
    !supportedEnvs.includes(kcEnv)
  ) {
    console.info(`
    Usage:
      node redo-idp-links --kc-env <env> --kc-realm <realm> [--totp <totp>]

    Flags:
      --kc-env             Base Keycloak environment. Available values: (dev, test, prod)
      --kc-realm           Base realm of the base Keycloak environment
      --totp                 Time-based One-time Password (TOTP) passed into the Keycloak auth call of the base environment; Optional
    `);
    return;
  }
  try {
    const adminClient = await getKeycloakAdminClient('gold', kcEnv, kcRealm, { totp });

    if (!adminClient) return;

    // find all idps from target realm
    const baseRealmIdps = await adminClient.identityProviders.find();

    // create a mapping between target realm idp alias and parent idp
    baseRealmIdps.map((idp) => {
      const urlPrefix = `https://${
        kcEnv === 'prod' ? '' : kcEnv + '.'
      }loginproxy.gov.bc.ca/auth/realms/standard/protocol/openid-connect/auth?kc_idp_hint=`;
      // only oidc and keycloak-oidc provider types are supported
      if (['oidc', 'keycloak-oidc'].includes(idp.providerId) && idp.config.authorizationUrl.startsWith(urlPrefix)) {
        let url = new URL(idp.config.authorizationUrl);
        if (url.searchParams.get('kc_idp_hint')) {
          baseRealmAliastoIdpMap[idp.alias] = url.searchParams.get('kc_idp_hint');
        }
      }
    });

    userReport = {
      'already-synced': [],
      'no-idp': [],
      'missing-idp': [],
      'updated': [],
    };

    const total = await adminClient.users.count({ realm: kcRealm });
    const max = 500;
    let start = 0;

    for (let i = 0; i < Math.ceil(total / max); i++) {
      let userList = await adminClient.users.find({
        realm: kcRealm,
        first: start,
        max,
      });

      for (let x = 0; x < userList.length; x++) {
        const baseUser = userList[x];
        const links = await adminClient.users.listFederatedIdentities({
          realm: kcRealm,
          id: baseUser.id,
        });

        if (links.length === 0) {
          continue;
        }

        const { identityProvider, userId, userName } = links[0];

        if (userId === userName) {
          continue;
        }

        if (!baseRealmAliastoIdpMap[identityProvider]) {
          continue;
        }

        await adminClient.users.delFromFederatedIdentity({
          realm: kcRealm,
          id: baseUser.id,
          federatedIdentityId: identityProvider,
        });

        await adminClient.users.addToFederatedIdentity({
          realm: kcRealm,
          id: baseUser.id,
          federatedIdentityId: identityProvider,
          federatedIdentity: {
            userId: userName,
            userName: userName,
            identityProvider: identityProvider,
          },
        });
        userReport['updated'].push(baseUser.id);
      }

      start = start + max;
    }
    console.log(userReport);
  } catch (ex) {
    console.error(ex);
  }
}

main();
