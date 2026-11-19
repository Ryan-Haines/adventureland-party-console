import type { EnqueueAsk } from './api.ts';

type Assert<T extends true> = T;
type Accepts<Contract, Input> = Input extends Contract ? true : false;
type Rejects<Contract, Input> = Input extends Contract ? false : true;

// An enqueue names a kind key or an add-on's reason, so tsc refuses a reason the table does not
// hold, like the misspelt 'merchant lcuk' below.
export type JobReasonContractChecks = [
  Assert<Accepts<EnqueueAsk['reason'], 'merchant luck'>>,
  Assert<Accepts<EnqueueAsk['reason'], 'addon:boss-zones:convoy'>>,
  Assert<Rejects<EnqueueAsk['reason'], 'merchant lcuk'>>,
  Assert<Rejects<EnqueueAsk['reason'], string>>,
];
