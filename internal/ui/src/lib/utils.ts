import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge with a `neu-bg` group registered so `neu-raised` and
 * `neu-inset` are mutually exclusive — same convention as Sleek's UI.
 */
const twMerge = extendTailwindMerge<"neu-bg">({
  extend: {
    classGroups: {
      "neu-bg": ["neu-raised", "neu-inset"],
    },
  },
});

export function cn(...inputs: Array<ClassValue>): string {
  return twMerge(clsx(inputs));
}
