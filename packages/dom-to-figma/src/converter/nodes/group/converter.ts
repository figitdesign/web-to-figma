import type { Position } from "../../dom";
import { getElementSize } from "../../dom";
import { parseOpacity } from "../../styles/opacity";
import type { FigmaGroupNodeChange, FigmaGuid } from "../../types";

type Params = {
  guid: FigmaGuid;
  parentGuid: FigmaGuid;
  childIndex: number;
  position: Position;
};

export function elementToGroupNodeChange(
  element: Element,
  options: Params
): FigmaGroupNodeChange {
  const { guid, parentGuid, childIndex, position } = options;

  const size = getElementSize(element);
  const computedStyle = window.getComputedStyle(element);

  const nodeChange: FigmaGroupNodeChange = {
    /* General Info */
    guid,
    phase: "CREATED",
    parentIndex: {
      guid: parentGuid,
      position: childIndex.toString(),
    },
    type: "GROUP",
    name: element.tagName.toLowerCase(),
    visible: true,
    opacity: parseOpacity(computedStyle.opacity),

    /* Size and Position */
    size: {
      x: size.width,
      y: size.height,
    },
    transform: {
      m00: 1.0,
      m01: 0.0,
      m02: position.x,
      m10: 0.0,
      m11: 1.0,
      m12: position.y,
    },

    /* Other */
    autoRename: true,
  };

  return nodeChange;
}
