import { createFileRoute, Link } from "@tanstack/react-router";

import { SCENES_BY_CATEGORY } from "../corpus";

export const Route = createFileRoute("/")({
  component: SceneIndex,
});

function SceneIndex() {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="font-semibold text-2xl tracking-tight">
          dom-to-figma playground
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
          Each scene below is a small HTML+CSS snippet that exercises one
          concern. Open one to inspect the payload and copy it to Figma.
        </p>

        <div className="mt-10 flex flex-col gap-10">
          {SCENES_BY_CATEGORY.map(({ category, scenes }) => (
            <section key={category}>
              <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                {category}
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                {scenes.map((scene) => (
                  <Link
                    className="block rounded-md border border-border bg-card/50 px-3 py-2 text-card-foreground text-sm transition hover:bg-accent hover:text-accent-foreground"
                    key={scene.slug}
                    params={{ _splat: scene.slug }}
                    to="/scenes/$"
                  >
                    {scene.name}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
