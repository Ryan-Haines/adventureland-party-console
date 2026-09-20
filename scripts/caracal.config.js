// Local caracAL configuration template. The session is supplied through the
// AL_SESSION environment variable by start-caracal.ps1 and is never stored here.
module.exports = {
  session: "",
  cull_versions: true,
  enable_TYPECODE: false,
  watch_CODE: true,
  log_level: "info",
  log_sinks: [["node", "./standalones/LogPrinter.js"]],
  web_app: {
    enable_bwi: false,
    enable_minimap: false,
    expose_CODE: true,
    expose_TYPECODE: false,
    party_dashboard: true,
    port: 924,
  },
  // Discover the account roster, then choose offline characters in the dashboard.
  characters: {},
  merchant: null,
};
