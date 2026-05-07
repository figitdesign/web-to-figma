import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "@sleekdesign/ui/lib/utils";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      className={cn(
        "shrink-0 bg-border data-horizontal:h-[var(--default-border-width)] data-horizontal:w-full data-vertical:w-[var(--default-border-width)] data-vertical:self-stretch",
        className
      )}
      data-slot="separator"
      orientation={orientation}
      {...props}
    />
  );
}

export { Separator };
