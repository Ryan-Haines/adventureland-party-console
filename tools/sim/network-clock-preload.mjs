// Native entrypoints must not create startup deadlines or Date values using
// the pool's old epoch before their authenticated clock participant has joined.
import clock from './network-clock.cjs';
await clock.install().ready;
