# Player NPC sales

Right-click an item in a player's inventory and choose **Sell to NPC** for a
one-time sale, or **Auto sell to NPC** for matching future items on that character.
Automatic rules match the item name, level, stat type, and special property.

The expandable **NPC sales** section on the player card shows pending pickups,
sale status, and automatic rules. Use **Remove** to cancel a pending sale or
**Remove rule** to stop that character's automatic rule.

The merchant collects the requested quantity, then queues its NPC sale work.
Players never travel to an NPC or sell the items themselves. Existing merchant
routine priorities remain in effect. Locked items and items reserved for other
work are blocked; sale intent survives inventory sorting and restarts.
