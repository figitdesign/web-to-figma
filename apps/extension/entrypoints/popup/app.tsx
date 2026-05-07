import { Button } from "@sleekdesign/ui/components/button";

export function App() {
  return (
    <main className="flex flex-col gap-3 p-4">
      <h1 className="font-heading font-medium text-base">Copy to Figma</h1>
      <p className="text-foreground-muted text-sm">
        Pick a section of the page or copy the whole thing into Figma.
      </p>
      <div className="flex flex-col gap-2">
        <Button>Copy whole page</Button>
        <Button variant="outline">Pick element…</Button>
      </div>
    </main>
  );
}
