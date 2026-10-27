import { getDecodePredictionCatalog, getDraftPredictionCatalog } from '../dist/staging-app.mjs';
import { buildEventPredictions, selectEventPredictionModel } from '../src/predictions/model.mjs';
import {
  summarizePredictionHistories,
  evaluatePredictionHistory,
} from '../src/predictions/history.mjs';
import eventHistory from '../data/predictions/decode-event-history.json' with { type: 'json' };
import { pricePredictionTeams } from '../src/predictions/pricing.mjs';

// The checked-in evidence is immutable for a deployment. Evaluate it once per isolate;
// do not replay every event for each authenticated page refresh.
function buildPriceQuote() {
  const historicalCatalog = getDecodePredictionCatalog();
  const draftCatalog = getDraftPredictionCatalog();
  const evidenceIds = new Set(
    [...historicalCatalog, ...draftCatalog].map((team) => Number(team.id)),
  );
  const history = {
    ...eventHistory,
    events: eventHistory.events
      .map((event) => ({
        ...event,
        teams: event.teams.filter((team) => evidenceIds.has(team.teamNumber)),
      }))
      .filter((event) => event.teams.length),
  };
  const summaries = summarizePredictionHistories(history, { season: 2025 });
  const report = evaluatePredictionHistory(history, { season: 2025 });
  const validation = selectEventPredictionModel(report);
  const draft = buildEventPredictions(draftCatalog, {
    histories: summaries.teams,
    method: validation.selectedMethod,
  });
  return pricePredictionTeams(draft.teams);
}
// Keep the established Pollen costs when removing the prediction leaderboard.
// No forecast or roster-ranking API is exposed by this pricing-only module.
const quote = buildPriceQuote();
const quotedPrices = new Map(quote.teams.map((team) => [team.id, team.price]));

// The shared application calls this only through the staging wrapper. Keep the
// whole eligible pool's quote independent of browser filters and planned events.
export function priceDraftCatalog(catalog) {
  if (
    !Array.isArray(catalog) ||
    catalog.length !== quotedPrices.size ||
    new Set(catalog.map((team) => team.id)).size !== quotedPrices.size ||
    catalog.some((team) => !quotedPrices.has(team.id))
  ) {
    throw new Error('Prediction prices do not match the eligible draft catalog.');
  }
  return {
    catalog: catalog.map((team) => ({ ...team, price: quotedPrices.get(team.id) })),
    pricing: { ...quote.pricing },
  };
}
