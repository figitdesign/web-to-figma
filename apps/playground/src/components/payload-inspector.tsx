import type { FigmaClipboard } from "@sleekdesign/dom-to-figma";
import { useMemo, useState } from "react";

type NodeChange = FigmaClipboard["nodeChanges"][number];

type TreeNode = {
  change: NodeChange;
  children: Array<TreeNode>;
};

type InspectorProps = {
  document: FigmaClipboard | null;
};

const ROOT_PLACEHOLDER_KEY = "__root__";

function buildTree(changes: ReadonlyArray<NodeChange>): Array<TreeNode> {
  const byParent = new Map<string, Array<NodeChange>>();
  for (const change of changes) {
    const parentKey = change.parentIndex
      ? `${change.parentIndex.guid.sessionID}:${change.parentIndex.guid.localID}`
      : ROOT_PLACEHOLDER_KEY;
    const bucket = byParent.get(parentKey) ?? [];
    bucket.push(change);
    byParent.set(parentKey, bucket);
  }

  const visit = (parentKey: string): Array<TreeNode> => {
    const direct = byParent.get(parentKey) ?? [];
    return direct.map((change) => {
      const key = `${change.guid.sessionID}:${change.guid.localID}`;
      return { change, children: visit(key) };
    });
  };

  return visit(ROOT_PLACEHOLDER_KEY);
}

function formatPosition(change: NodeChange): string | null {
  if (!change.transform) {
    return null;
  }
  return `${formatNumber(change.transform.m02)}, ${formatNumber(change.transform.m12)}`;
}

function formatSize(change: NodeChange): string | null {
  if (!change.size) {
    return null;
  }
  return `${formatNumber(change.size.x)} × ${formatNumber(change.size.y)}`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function summarizeFills(change: NodeChange): string | null {
  if (!("fillPaints" in change && change.fillPaints?.length)) {
    return null;
  }
  return change.fillPaints
    .map((paint) => {
      if (paint.type === "SOLID") {
        const { r, g, b } = paint.color;
        const opacity = paint.opacity ?? 1;
        return `solid(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)} @ ${opacity.toFixed(2)})`;
      }
      if (paint.type === "IMAGE") {
        return "image";
      }
      return paint.type.toLowerCase();
    })
    .join(", ");
}

function summarizeEffects(change: NodeChange): string | null {
  if (!("effects" in change && change.effects?.length)) {
    return null;
  }
  return change.effects.map((effect) => effect.type.toLowerCase()).join(", ");
}

function summarizeText(change: NodeChange): string | null {
  if (change.type !== "TEXT") {
    return null;
  }
  const characters = change.characters;
  const preview =
    characters.length > 36 ? `${characters.slice(0, 36)}…` : characters;
  return `“${preview}” · ${change.fontName?.family ?? "?"} ${change.fontName?.style ?? ""} · ${change.fontSize ?? "?"}px`.trim();
}

// Type-tag colors are semantic to node kind, not chrome — they're info graphics
// that should stay legible regardless of the surrounding theme tokens.
const TYPE_PALETTE: Record<string, string> = {
  DOCUMENT: "text-muted-foreground",
  CANVAS: "text-muted-foreground",
  FRAME: "text-blue-300",
  GROUP: "text-purple-300",
  TEXT: "text-emerald-300",
  VECTOR: "text-amber-300",
  ROUNDED_RECTANGLE: "text-pink-300",
};

function disclosureGlyph(hasChildren: boolean, expanded: boolean): string {
  if (!hasChildren) {
    return "·";
  }
  return expanded ? "▾" : "▸";
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 3);
  const hasChildren = node.children.length > 0;
  const palette = TYPE_PALETTE[node.change.type] ?? "text-foreground";
  const size = formatSize(node.change);
  const position = formatPosition(node.change);
  const fills = summarizeFills(node.change);
  const effects = summarizeEffects(node.change);
  const text = summarizeText(node.change);
  const disclosure = disclosureGlyph(hasChildren, expanded);

  return (
    <div>
      <button
        className="flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
        onClick={() => hasChildren && setExpanded((prev) => !prev)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        type="button"
      >
        <span className="w-3 shrink-0 text-muted-foreground">{disclosure}</span>
        <span className={`shrink-0 font-mono ${palette}`}>
          {node.change.type}
        </span>
        <span className="shrink-0 text-foreground">{node.change.name}</span>
        {size && <span className="shrink-0 text-muted-foreground">{size}</span>}
        {position && (
          <span className="shrink-0 text-muted-foreground">@{position}</span>
        )}
        {text && <span className="truncate text-muted-foreground">{text}</span>}
        {fills && (
          <span className="truncate text-muted-foreground">{fills}</span>
        )}
        {effects && (
          <span className="truncate text-muted-foreground">fx: {effects}</span>
        )}
      </button>
      {expanded &&
        node.children.map((child) => (
          <TreeRow
            depth={depth + 1}
            key={`${child.change.guid.sessionID}:${child.change.guid.localID}`}
            node={child}
          />
        ))}
    </div>
  );
}

export function PayloadInspector({ document }: InspectorProps) {
  const tree = useMemo(
    () => (document ? buildTree(document.nodeChanges) : []),
    [document]
  );

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
        Run a conversion to inspect the payload.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-border border-b px-3 py-2 text-muted-foreground text-xs">
        <span>
          {document.nodeChanges.length} nodes · {document.blobs.length} blobs
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono">
        {tree.map((node) => (
          <TreeRow
            depth={0}
            key={`${node.change.guid.sessionID}:${node.change.guid.localID}`}
            node={node}
          />
        ))}
      </div>
    </div>
  );
}
