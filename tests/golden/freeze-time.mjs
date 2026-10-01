// Pins Date to HUD_FAKE_NOW so golden output is deterministic.
const fixed = Number(process.env.HUD_FAKE_NOW);
if (Number.isFinite(fixed)) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
}
