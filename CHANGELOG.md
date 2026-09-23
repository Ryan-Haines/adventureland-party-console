# Changelog

## Unreleased

Changes queued for the next release. The release workflow determines its version
from the commits merged into `main`.

### Fixed

- Passive hunting pauses attacks when travel unexpectedly stops and recovers stalled
  convoys toward their existing destination.
- Merchant collection and commerce run alongside party movement without pausing
  travel. Persisted service receipts prevent completed transfers from being repeated.
- Moving attacks respect class MP reserves and pending spending, while resource
  recovery continues during travel.
