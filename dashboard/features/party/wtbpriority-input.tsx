"use client";
import { Input } from "@/components/ui/input";

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
      title="0–100, higher first; blank uses routine priority"
      inputMode="numeric"
      placeholder="Default"
      value={value}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value.replace(/[^0-9]/g, "");
        onChange(next === "" ? "" : String(Math.min(100, Number(next))));
      }}
      className={`min-w-0 border-violet-600 bg-black text-violet-100 placeholder:text-violet-300 hover:border-violet-400 ${className}`}
    />
  );
}
