"use client";
import { Input } from "@/components/ui/input";
import { ROUTINE_PRIORITY } from "../../../runtime/merchant-jobs/api.ts";

export function WTBPriorityInput({
  value,
  onChange, className = "",
  onBlur,
  onKeyDown,
  disabled,
}: {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  disabled?: boolean;
}) {
  return (
    <Input
      aria-label="Priority override"
      title={`${ROUTINE_PRIORITY.min}–${ROUTINE_PRIORITY.max}, higher first; blank uses routine priority`}
      inputMode="numeric"
      placeholder="Default"
      value={value}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value.replace(/[^0-9]/g, "");
        onChange(next === "" ? "" : String(Math.min(ROUTINE_PRIORITY.max, Number(next))));
      }}
      className={`min-w-0 border-violet-600 bg-black text-violet-100 placeholder:text-violet-300 hover:border-violet-400 ${className}`}
    />
  );
}
