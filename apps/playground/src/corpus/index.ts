// Every `*.html` file under `src/corpus/<category>/<slug>.html` becomes a
// playground scene. Filenames are kebab-case and end up as URL slugs prefixed
// by the category, e.g. `typography/headings`.
const rawHtmlByPath = import.meta.glob("./*/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type Scene = {
  slug: string;
  category: string;
  name: string;
  html: string;
};

const CATEGORY_ORDER = [
  "scratch",
  "typography",
  "color",
  "layout",
  "positioning",
  "borders",
  "effects",
  "svg",
  "forms",
  "integrations",
] as const;

function categoryRank(category: string): number {
  const idx = (CATEGORY_ORDER as ReadonlyArray<string>).indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parsePath(path: string): { category: string; name: string } | null {
  // path is like "./typography/headings.html"
  const match = /^\.\/([^/]+)\/([^/]+)\.html$/.exec(path);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return { category: match[1], name: match[2] };
}

const SCENES: ReadonlyArray<Scene> = Object.entries(rawHtmlByPath)
  .flatMap(([path, html]) => {
    const parsed = parsePath(path);
    if (!parsed) {
      return [];
    }
    return [
      {
        slug: `${parsed.category}/${parsed.name}`,
        category: parsed.category,
        name: titleFromSlug(parsed.name),
        html,
      },
    ];
  })
  .sort((a, b) => {
    const rankDiff = categoryRank(a.category) - categoryRank(b.category);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.slug.localeCompare(b.slug);
  });

const SCENES_BY_SLUG: ReadonlyMap<string, Scene> = new Map(
  SCENES.map((scene) => [scene.slug, scene])
);

export function getScene(slug: string): Scene | undefined {
  return SCENES_BY_SLUG.get(slug);
}

export const SCENES_BY_CATEGORY: ReadonlyArray<{
  category: string;
  scenes: ReadonlyArray<Scene>;
}> = (() => {
  const map = new Map<string, Array<Scene>>();
  for (const scene of SCENES) {
    const list = map.get(scene.category) ?? [];
    list.push(scene);
    map.set(scene.category, list);
  }
  return Array.from(map.entries()).map(([category, scenes]) => ({
    category,
    scenes,
  }));
})();
