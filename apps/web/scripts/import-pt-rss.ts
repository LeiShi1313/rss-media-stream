import { loadConfig } from "../src/server/config.js";
import { prisma } from "../src/server/db.js";
import {
  parsePtRssImportArgs,
  runPtRssImport
} from "../src/server/modules/imports/ptRssImport.runner.js";

const options = parsePtRssImportArgs(process.argv.slice(2));
const config = options.resolveProviders ? loadConfig() : undefined;

try {
  const summary = await runPtRssImport(options, config);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prisma.$disconnect();
}
