"use client";

export type EscapeStatus = {
  id: string;
  stage: string;
  error: string | null;
  progress: Record<string, { error?: string | null }>;
};
