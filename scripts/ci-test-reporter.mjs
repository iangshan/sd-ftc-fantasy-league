// Emit failed-test details as GitHub annotations as well as the normal test log.
// CI test steps run without deployment credentials and use synthetic fixtures.
const escape = (value) =>
  String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export default async function* report(events) {
  for await (const { type, data } of events) {
    if (type !== 'test:fail' || data.details.error.failureType === 'subtestsFailed') continue;
    const error = data.details.error;
    const detail = error.cause?.stack || error.stack || error.message;
    yield `::error::${escape(`${data.name}: ${detail}`.slice(0, 4000))}\n`;
  }
}
