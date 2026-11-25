# Native fixture network isolation

Before editing fixture behavior, all local heartbeats, movement acknowledgements,
map telemetry and assets pass through `context.route('**/*')` before being
continued. Native failures show one-to-two-second loopback round trips with
roughly ten milliseconds of coordinator processing and repeated three-second
report holds. This suggests browser/CDP transport contention, not proven native
server delay.

Failure modes: external HTTP/HTTPS/WebSocket escapes isolation; localhost,
IPv4/IPv6 loopback or native companion requests incorrectly proxy; proxy bypass
allows non-loopback endpoints; denial ledger disappears; timing improvement is
assumed without evidence. Before changing the fixture, run an isolated native
browser network proof against real local HTTP/WebSocket endpoints and a
controlled non-loopback target. Retain allowed/blocked receipts and repeated
hundred-request timing for the old interception and owned local denial proxy
with explicit loopback bypass. No gameplay success or timeout is fabricated.

Run `node tools/testing/native-network-isolation.cjs` to repeat the browser experiment. It retains allowed and blocked receipts and three timing trials per mode in `.build/native-network-proof.json`. The proxy binds a port it owns and destroys HTTP, CONNECT and WebSocket requests without resolving or forwarding the destination. Native CI must verify any gameplay improvement; the isolated benchmark alone does not establish its cause.
