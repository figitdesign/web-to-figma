import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

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
