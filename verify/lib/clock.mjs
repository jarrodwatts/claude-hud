// Preload: pins Date to VERIFY_NOW (ms) so a case's `now` holds while the HUD renders.
const now = Number(process.env.VERIFY_NOW);
if (Number.isFinite(now)) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
}
