import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

export type MontagePanel = {
  label: string;
  sub: string;
  tone: string;
  dataUri: string;
};

/** Pure: title + panels -> a standalone HTML montage document. */
export function buildMontageHtml(
  title: string,
  panels: ReadonlyArray<MontagePanel>,
  displayWidth = 260
): string {
  const cell = (p: MontagePanel) =>
    `<figure class="panel"><figcaption class="cap" style="color:${p.tone}">${p.label} <span class="sub">${p.sub}</span></figcaption><img class="shot" src="${p.dataUri}" alt="${p.label}"></figure>`;
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#0f172a}
    .wrap{padding:22px;display:inline-block}
    h1{font-size:14px;margin:0 0 16px;font-weight:650;letter-spacing:.01em}
    .row{display:flex;gap:18px;align-items:flex-start}
    .panel{margin:0;display:flex;flex-direction:column;gap:9px}
    .cap{font-weight:650;font-size:11px;text-transform:uppercase;letter-spacing:.055em}
    .cap .sub{font-weight:400;text-transform:none;letter-spacing:0;color:#94a3b8;margin-left:2px}
    .shot{width:${displayWidth}px;height:auto;display:block;background:#fff;border:1px solid #e2e8f0;border-radius:8px}
  </style><div class="wrap"><h1>${title}</h1><div class="row">${panels.map(cell).join("")}</div></div>`;
}

const TONES = {
  target: "#334155",
  before: "#b42318",
  after: "#0a7d33",
} as const;

/** Read the three PNGs, build the montage, screenshot the `.wrap` element to `out`. */
export async function renderMontage(opts: {
  title: string;
  targetPng: string;
  beforePng: string;
  afterPng: string;
  out: string;
}): Promise<void> {
  const uri = (p: string) =>
    `data:image/png;base64,${readFileSync(p).toString("base64")}`;
  const panels: Array<MontagePanel> = [
    {
      label: "Target",
      sub: "browser",
      tone: TONES.target,
      dataUri: uri(opts.targetPng),
    },
    {
      label: "Before",
      sub: "this PR",
      tone: TONES.before,
      dataUri: uri(opts.beforePng),
    },
    {
      label: "After",
      sub: "this PR",
      tone: TONES.after,
      dataUri: uri(opts.afterPng),
    },
  ];
  const html = buildMontageHtml(opts.title, panels);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() =>
      Promise.all(
        [...document.images].map((i) => i.decode().catch(() => undefined))
      )
    );
    mkdirSync(dirname(opts.out), { recursive: true });
    const el = await page.$(".wrap");
    if (!el) {
      throw new Error("montage root not found");
    }
    await el.screenshot({ path: opts.out });
  } finally {
    await browser.close();
  }
}
