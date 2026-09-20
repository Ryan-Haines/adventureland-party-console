"use client";

import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  canRouteToMonster,
  FOLLOWER_ROUTE_MESSAGE,
  type RoutingFormation,
} from "@/lib/party-routing";

export function MonsterRouteButton({
  formation,
  character,
  onRoute,
}: {
  formation: RoutingFormation;
  character: string;
  onRoute: () => void;
}) {
  const disabled = !canRouteToMonster(formation, character);
  const description = disabled ? FOLLOWER_ROUTE_MESSAGE : "Find selected monster";
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button type="button" size="icon" variant="outline" />}
        aria-label={description}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) onRoute();
        }}
        className="h-10 w-10 shrink-0 border-cyan-800 bg-[#07100f] text-cyan-300 hover:bg-cyan-950 hover:text-cyan-200 aria-disabled:opacity-60"
      >
        <MapPin className="h-4 w-4" />
      </TooltipTrigger>
      <TooltipContent className="border border-cyan-700 bg-[#07100f] text-cyan-100">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
