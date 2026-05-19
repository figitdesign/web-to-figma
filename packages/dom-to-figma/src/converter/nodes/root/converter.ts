import type {
  FigmaBlob,
  FigmaCanvasNodeChange,
  FigmaClipboard,
  FigmaDocumentNodeChange,
  FigmaFrameNodeChange,
  FigmaGuid,
} from "../../types";

const DEFAULT_FRAME_NAME = "Frame";

function getGuid(id: number): FigmaGuid {
  return {
    sessionID: 0,
    localID: id,
  };
}

const DOCUMENT_LOCAL_ID = 0;
const CANVAS_LOCAL_ID = 1;
const FRAME_LOCAL_ID = 2;

const createDocumentNodeChange: FigmaDocumentNodeChange = {
  guid: getGuid(DOCUMENT_LOCAL_ID),
  phase: "CREATED",
  type: "DOCUMENT",
  name: "Unnamed",
  visible: true,
  opacity: 1.0,
  blendMode: "PASS_THROUGH",
  mask: false,
  maskType: "ALPHA",
};

const getCanvasNodeChange = (name: string): FigmaCanvasNodeChange => ({
  guid: getGuid(CANVAS_LOCAL_ID),
  phase: "CREATED",
  parentIndex: {
    guid: {
      sessionID: 0,
      localID: 0,
    },
    position: "!",
  },
  type: "CANVAS",
  name,
  visible: true,
  opacity: 1.0,
  blendMode: "PASS_THROUGH",
  transform: {
    m00: 1.0,
    m01: 0.0,
    m02: 0.0,
    m10: 0.0,
    m11: 1.0,
    m12: 0.0,
  },
  mask: false,
  maskType: "ALPHA",
  backgroundOpacity: 1.0,
  backgroundEnabled: true,
});

export const ROOT_FRAME_GUID = getGuid(FRAME_LOCAL_ID);

// Shared helper to create frame node changes for both single and multi-frame exports
const createFrameNodeChange = ({
  guid,
  width,
  height,
  name,
  x = 0,
  y = 0,
}: {
  guid: FigmaGuid;
  width: number;
  height: number;
  name: string;
  x?: number;
  y?: number;
}): FigmaFrameNodeChange => ({
  guid,
  phase: "CREATED",
  parentIndex: {
    guid: {
      sessionID: 0,
      localID: CANVAS_LOCAL_ID,
    },
    position: "!",
  },
  type: "FRAME",
  name,
  visible: true,
  opacity: 1.0,
  blendMode: "PASS_THROUGH",
  size: {
    x: width,
    y: height,
  },
  transform: {
    m00: 1.0,
    m01: 0.0,
    m02: x,
    m10: 0.0,
    m11: 1.0,
    m12: y,
  },
  strokeWeight: 1.0,
  strokeAlign: "INSIDE",
  strokeJoin: "MITER",
  fillPaints: [
    {
      type: "SOLID",
      color: {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
      },
      opacity: 1.0,
      visible: true,
      blendMode: "NORMAL",
    },
  ],
  frameMaskDisabled: false,
  stackMode: "VERTICAL",
});

export const getRootTemplate = ({
  width,
  height,
  blobs,
  name = DEFAULT_FRAME_NAME,
}: {
  width: number;
  height: number;
  blobs: Array<FigmaBlob>;
  name?: string;
}): FigmaClipboard => ({
  type: "NODE_CHANGES",
  sessionID: 0,
  ackID: 0,
  nodeChanges: [
    createDocumentNodeChange,
    getCanvasNodeChange(name),
    createFrameNodeChange({ guid: ROOT_FRAME_GUID, width, height, name }),
  ],
  blobs,
  pasteID: 777,
  pasteFileKey: "IAMA_DUMMY_FILE_KEY_AMA",
  pasteIsPartiallyOutsideEnclosingFrame: false,
  isCut: false,
  pasteEditorType: "DESIGN",
  publishedAssetGuids: [],
});

type FrameConfig = {
  width: number;
  height: number;
  x: number;
  y: number;
  name: string;
  localId: number;
};

export const getMultiFrameRootTemplate = ({
  frames,
  blobs,
  canvasName = DEFAULT_FRAME_NAME,
}: {
  frames: Array<FrameConfig>;
  blobs: Array<FigmaBlob>;
  canvasName?: string;
}): FigmaClipboard => {
  const frameNodeChanges: Array<FigmaFrameNodeChange> = frames.map((frame) =>
    createFrameNodeChange({
      guid: getGuid(frame.localId),
      width: frame.width,
      height: frame.height,
      name: frame.name,
      x: frame.x,
      y: frame.y,
    })
  );

  return {
    type: "NODE_CHANGES",
    sessionID: 0,
    ackID: 0,
    nodeChanges: [
      createDocumentNodeChange,
      getCanvasNodeChange(canvasName),
      ...frameNodeChanges,
    ],
    blobs,
    pasteID: 777,
    pasteFileKey: "IAMA_DUMMY_FILE_KEY_AMA",
    pasteIsPartiallyOutsideEnclosingFrame: false,
    isCut: false,
    pasteEditorType: "DESIGN",
    publishedAssetGuids: [],
  };
};
