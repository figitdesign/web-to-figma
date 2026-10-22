---
"@figit/dom-to-figma": patch
---

Paint negative z-index layers below in-flow content, as CSS does. They were listed after it, so a `z-index: -1` backdrop covered the whole design.
