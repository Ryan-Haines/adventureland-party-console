# Farming zones and recovery

Normal farming and Monster Hunt carry the selected spawn geometry through navigation and target selection. Overlapping packs of the same monster are merged as a union, preserving gaps. New targets come exclusively from eligible visible monsters inside the selected zone when any exist. Only when that set is empty may targets within the configured radius of the zone center be nominated. This does not expand vision or scan unseen neighboring zones. Pending/engaged fights retain their identity; defense and passive rare priorities still apply. Point destinations use their radius directly.

A stalled approach waits 1.5 seconds without meaningful progress before local corner recovery or one bounded smart route. Active combat suppresses smart-route recovery. Routes expire after 30 seconds, and failed targets receive a 10-second retry cooldown. Idle searching uses cached valid points inside the zone. Hunt scatter remains automatic.

Competition evidence uses the existing hit listener: two damaging hits or one kill by an outsider within 10 seconds marks a zone busy for two minutes. Owned characters are excluded. Relocation waits for current fights to finish and prefers the same map, monster coverage, and observed quiet alternatives. Unknown areas are candidates, not guaranteed empty. If every alternative is busy, stay and share. Automatic moves have a two-minute cooldown.

Movement locks are retried for up to 10 seconds before convoy failure. Failed farming travel retries once, then tries another zone. Exhausted Hunt routes skip that mission without adding a death blacklist entry; exhausted normal farming routes show a paused status. New navigation invalidates a queued relocation.
