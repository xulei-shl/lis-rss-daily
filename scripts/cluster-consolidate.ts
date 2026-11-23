import { ensureActiveSet } from '../src/topic-cluster/pipeline/index.js';
import { consolidateSmallTopics } from '../src/topic-cluster/service/consolidation.js';

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  return {
    dryRun: args.has('--dry-run'),
  };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const { setVersion } = await ensureActiveSet();
  const result = await consolidateSmallTopics(setVersion, { dryRun });

  console.log(JSON.stringify(result, null, 2));
  if (result.merges.length > 0) {
    console.log(`\n整合 ${result.merges.length} 个微主题，剩余样本不足主题 ${result.remainingSmall} 个。`);
  } else {
    console.log(`\n没有需要整合的微主题，剩余样本不足主题 ${result.remainingSmall} 个。`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
