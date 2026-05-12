import { html } from "@codemirror/lang-html";
import type { ConvertResult } from "@sleekdesign/dom-to-figma";
import { Button } from "@sleekdesign/ui/components/button";
import { Input } from "@sleekdesign/ui/components/input";
import { Spinner } from "@sleekdesign/ui/components/spinner";
import CodeMirror from "@uiw/react-codemirror";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Scene } from "../corpus";
import { getConverter } from "../lib/converter";
import { PayloadInspector } from "./payload-inspector";

const CONVERT_DEBOUNCE_MS = 300;

type Props = {
  scene: Scene;
};

function copyButtonLabel({
  isCopying,
  isConverting,
}: {
  isCopying: boolean;
  isConverting: boolean;
}): string {
  if (isCopying) {
    return "Copying…";
  }
  if (isConverting) {
    return "Converting…";
  }
  return "Copy to Figma";
}

export function PlaygroundShell({ scene }: Props) {
  const [code, setCode] = useState(scene.html);
  const previewCode = useDeferredValue(code);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(800);
  const [frameName, setFrameName] = useState(scene.name);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Reset to the scene's source when the user navigates between scenes.
  useEffect(() => {
    setCode(scene.html);
    setFrameName(scene.name);
    setResult(null);
    setStatus(null);
  }, [scene.html, scene.name]);

  const runConversion = useCallback(async () => {
    const body = iframeRef.current?.contentDocument?.body;
    if (!body) {
      return;
    }
    setIsConverting(true);
    try {
      const converted = await getConverter().convert({
        element: body,
        width: width || 1,
        height: height || 1,
        name: frameName,
      });
      setResult(converted);
      setStatus(null);
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: surfaces converter failures during local iteration
      console.error("Convert failed:", error);
      setStatus(error instanceof Error ? error.message : "Conversion failed");
    } finally {
      setIsConverting(false);
    }
  }, [width, height, frameName]);

  // Re-run conversion when width/height/name change. Code changes are picked
  // up via the iframe's onLoad after srcDoc swaps.
  useEffect(() => {
    const id = window.setTimeout(runConversion, CONVERT_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [runConversion]);

  const copyToFigma = async () => {
    if (!result) {
      setStatus("Nothing to copy yet — wait for the conversion.");
      return;
    }
    setIsCopying(true);
    try {
      await navigator.clipboard.write([result.toClipboardItem()]);
      setStatus("Copied. Paste in Figma with Cmd+V.");
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: surfaces clipboard failures during local iteration
      console.error("Copy failed:", error);
      setStatus(error instanceof Error ? error.message : "Copy failed");
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-border border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">
            {scene.category}
          </span>
          <h1 className="font-semibold text-sm">{scene.name}</h1>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-sm">
          <Input
            aria-label="Width"
            className="w-20 tabular-nums"
            min={1}
            onChange={(event) => setWidth(event.target.valueAsNumber || 0)}
            type="number"
            value={width || ""}
          />
          <span className="text-muted-foreground">×</span>
          <Input
            aria-label="Height"
            className="w-20 tabular-nums"
            min={1}
            onChange={(event) => setHeight(event.target.valueAsNumber || 0)}
            type="number"
            value={height || ""}
          />
        </div>
        <Input
          aria-label="Frame name"
          className="w-32"
          onChange={(event) => setFrameName(event.target.value)}
          placeholder="Frame name"
          value={frameName}
        />
        <Button
          disabled={isCopying || isConverting || !result}
          onClick={copyToFigma}
          size="sm"
        >
          {(isCopying || isConverting) && <Spinner />}
          {copyButtonLabel({ isCopying, isConverting })}
        </Button>
      </header>

      {status && (
        <div className="border-border border-b bg-muted px-4 py-2 text-muted-foreground text-xs">
          {status}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_1fr] overflow-hidden">
        <div className="min-h-0 overflow-auto border-border border-r">
          <CodeMirror
            extensions={[html()]}
            height="100%"
            onChange={setCode}
            theme="dark"
            value={code}
          />
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: onLoad fires when the iframe content is ready, which we need to trigger conversion */}
        <iframe
          className="h-full w-full border-border border-r"
          onLoad={runConversion}
          ref={iframeRef}
          srcDoc={previewCode}
          title="Preview"
        />
        <div className="min-h-0 overflow-hidden">
          <PayloadInspector document={result?.document ?? null} />
        </div>
      </div>
    </div>
  );
}
