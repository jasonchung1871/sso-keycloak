import yargs from 'yargs/yargs';
import { createContainer } from 'container';
import { fetchBceidUser } from 'helpers/webservice-bceid';

const argv = yargs(process.argv.slice(2))
  .options({
    env: { type: 'string', default: null },
    type: { type: 'string', default: 'Individual' },
    property: { type: 'string', default: 'userGuid' },
    search: { type: 'string', default: '' },
    auto: { type: 'boolean', default: false },
  })
  .parseSync();

const { type, search, property, env, auto } = argv;

if (!env || !search) {
  console.info(`
Usages:
  yarn script scripts/test-webservice-bceid --type <type> --search <search> --env <env> [--auto]

Flags:
  --env            BCeID web service environment; dev | test | prod
  --type           BCeID account type; Business | Individual
  --property       BCeID search property; userGuid | userId
  --search         BCeID account search value
  --auto           Skips the confirmation before running the script
`);

  process.exit(1);
}

const container = createContainer(auto);
container(async () => {
  const result = await fetchBceidUser({ accountType: type, property, matchKey: search, env });
  console.log('result', result);
});
