import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { PlaygroundShell } from "../components/playground-shell";
import { getScene } from "../corpus";

export const Route = createFileRoute("/scenes/$")({
  component: ScenePage,
  loader: ({ params }) => {
    const scene = getScene(params._splat ?? "");
    if (!scene) {
      throw notFound();
    }
    return { scene };
  },
  notFoundComponent: SceneNotFound,
});

function ScenePage() {
  const { scene } = Route.useLoaderData();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-4 py-2 text-xs">
        <Link className="text-muted-foreground hover:text-foreground" to="/">
          ← All scenes
        </Link>
        <span className="text-border">/</span>
        <span className="text-muted-foreground">{scene.category}</span>
      </div>
      <PlaygroundShell scene={scene} />
    </div>
  );
}

function SceneNotFound() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
      <div className="flex flex-col items-center gap-2">
        <p>Scene not found.</p>
        <Link className="text-primary hover:text-primary/80" to="/">
          Back to gallery
        </Link>
      </div>
    </div>
  );
}
