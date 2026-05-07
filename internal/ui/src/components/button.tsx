import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@sleekdesign/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-[color,box-shadow,scale] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "neu-raised text-primary-foreground shadow-xs [--neu-base:var(--primary)] hover:brightness-95",
        destructive:
          "neu-raised text-white shadow-xs [--neu-base:var(--destructive)] hover:brightness-95 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "neu-raised border border-border shadow-xs [--neu-base:var(--background)] hover:text-accent-foreground hover:[--neu-base:var(--accent)]",
        secondary:
          "neu-raised text-secondary-foreground shadow-xs [--neu-base:var(--secondary)] hover:brightness-95",
        ghost:
          "hover:neu-raised data-[active=true]:neu-raised hover:text-accent-foreground data-[active=true]:text-accent-foreground hover:[--neu-base:var(--accent)] data-[active=true]:[--neu-base:var(--accent)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button"
      {...props}
    />
  );
}

export { Button, buttonVariants };
