// Reproduce the chronological experiment without changing the live model or data.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluatePredictionHistory } from '../prediction-history.mjs';

const args = process.argv.slice(2);
if (args.length > 2)
  throw new Error('Usage: node scripts/evaluate-prediction-model.mjs [history.json] [report.json]');
const input = resolve(args[0] ?? 'prediction-data/decode-event-history.json');
const history = JSON.parse(await readFile(input, 'utf8'));
const report = evaluatePredictionHistory(history);
const selection = report.split.selection;
const holdout = report.split.holdout;
console.log(
  `DECODE next-event OPR replay: ${report.coverage.predictedEvents} forecasts from ${report.coverage.scoredEvents} measured team/event rows.`,
);
console.log(
  `Earlier selection block: ${selection.exampleCount} forecasts; selected method: ${selection.candidate ?? 'insufficient evidence'}.`,
);
console.log(
  `Later test block: ${holdout.exampleCount} forecasts from ${holdout.startDate ?? 'no split available'}.`,
);
for (const [method, metric] of Object.entries(holdout.metrics)) {
  console.log(
    `${method}: MAE ${metric.mae?.toFixed(3) ?? 'unavailable'} OPR; RMSE ${metric.rmse?.toFixed(3) ?? 'unavailable'} OPR.`,
  );
}
console.log(
  'The later block is for checking the earlier choice, not choosing a different winner. This historical replay does not validate a new game or supply calibrated uncertainty ranges.',
);
if (args[1]) {
  const output = resolve(args[1]);
  if (output === input) throw new Error('The report must not overwrite the source history.');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`Wrote new report: ${output}`);
}
