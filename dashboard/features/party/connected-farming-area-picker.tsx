'use client';
import type { ComponentProps } from 'react';
import { FarmingAreaPicker } from './farming-area-picker';
import { useCharacterData } from './dashboard-live';
import { audited } from './field-read-audit';

export function ConnectedFarmingAreaPicker(props: ComponentProps<typeof FarmingAreaPicker>) {
  const position = useCharacterData(props.character?.name || '', 'position');
  const character = props.character && audited('merged', { ...props.character, ...position });
  return <FarmingAreaPicker {...props} character={character} />;
}
