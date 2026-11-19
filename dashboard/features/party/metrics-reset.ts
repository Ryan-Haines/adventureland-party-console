import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MetricResetKind } from '../../../runtime/status/api.ts';
import { parseMetricResets } from '../../../runtime/status/api.ts';
import { performAction } from './query-actions';

/** Only a user click calls this destructive endpoint. Filter changes never erase data. */
export function useMetricsReset() {
  const client = useQueryClient();
  return useMutation({
    scope: { id: 'metrics-reset' },
    mutationFn: async (metric: MetricResetKind | 'all' | 'performance') => {
      const result: unknown = await performAction(client, '/metrics/reset', { metric });
      const resets = result && typeof result === 'object' && 'resets' in result ? parseMetricResets(result.resets) : null;
      if (!resets) throw new Error('Invalid metrics reset response');
      return resets;
    },
    onMutate: () => client.cancelQueries({ queryKey: ['party', 'metrics'] }),
    onSuccess: () => { client.removeQueries({ queryKey: ['party', 'metrics'], type: 'inactive' }); },
    onSettled: () => client.invalidateQueries({ queryKey: ['party', 'metrics'] }),
  });
}
