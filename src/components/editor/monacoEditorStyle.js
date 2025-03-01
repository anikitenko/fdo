import virtualFS from "./utils/VirtualFS";

const stylesTopFixed = `
.quick-input-widget {
    box-shadow: 0 5px 10px rgba(0,0,0,0), 0 0 0 100vw rgba(0,0,0,0.15) !important;
    top: 80px !important;
    position: fixed !important;
    top: 0 !important;
  }
`

const stylesTop = `
  .quick-input-widget {
    box-shadow: 0 5px 10px rgba(0,0,0,0), 0 0 0 100vw rgba(0,0,0,0.15) !important;
    top: 80px !important;
  }
  `
const stylesRest = `
  .quick-input-widget .monaco-inputbox {
    padding: 10px !important;
    border-radius: 5px !important;
    font-size: 14px !important;
  }
  .quick-input-widget .quick-input-action {
    padding-top: 10px !important;
    font-size: 14px !important;
  }
  .quick-input-widget .monaco-list-rows {
    font-size: 13px !important;
  }
  .quick-input-widget .monaco-list-row {
    padding: 5px !important;
    height: auto !important;
  }
  .quick-input-widget .quick-input-list-entry {
    position: relative;
    padding: 0px 5px 0px 15px;
  }
  .quick-input-widget .quick-input-list-entry .codicon[class*=codicon-] {
    font-size: 15px;
  }
  .quick-input-widget .quick-input-list .quick-input-list-entry.quick-input-list-separator-border {
    border-top-width: 0px !important;
  }
  .quick-input-widget .quick-input-list .quick-input-list-label-meta .monaco-highlighted-label:before {
    content: ' ▸ ';
  }
  .quick-input-widget .quick-input-list .quick-input-list-entry .monaco-action-bar.animated.quick-input-list-entry-action-bar {
    height: unset;
  }
  `

let styleElement;
function monacoEditorStyle() {
    styleElement = document.createElement("style");
    styleElement.textContent = stylesTop+stylesRest;
    document.head.appendChild(styleElement);

    let menuExist = false;
    let quickInputListNode = null;
    let factor = 1;
    let refresh = false;
    let cachedHeight = -1;
    let cachedPreOneTop = 0;

    const zoom = (obj, primaryKey, cacheKey) => {
        const v = parseInt(obj.style[primaryKey], 10);
        if (refresh || !obj.hasOwnProperty(cacheKey) || obj[cacheKey] !== v) {
            set(obj, Math.round(v * factor), primaryKey, cacheKey);
            return true;
        }
        return v === 0;
    }

    const set = (obj, v, primaryKey, cacheKey) => {
        obj[cacheKey] = v;
        obj.style[primaryKey] = obj[cacheKey] + "px";
    }

    const setPaddingBottom = (obj, v) => {
        if (parseInt(obj.style.paddingBottom, 10) !== v) {
            obj.style["paddingBottom"] = v + "px";
        }
    }

    const resize = () => {
        const isTop = virtualFS.getQuickInputWidgetTop()
        if (isTop) {
            styleElement.textContent = stylesTopFixed+stylesRest;
        } else {
            styleElement.textContent = stylesTop+stylesRest;
        }
        const monacoListRows =
            quickInputListNode.querySelector(".monaco-list-rows");
        const rows = quickInputListNode.querySelectorAll(
            ".monaco-list-rows .monaco-list-row"
        );

        refresh = false;
        if (rows && rows.length > 0) {
            const defaultHeight = parseInt(rows[0].style.height, 10);
            if (defaultHeight !== cachedHeight) {
                factor = (defaultHeight + 10) / defaultHeight;
                cachedHeight = defaultHeight;
                refresh = true;
            }
            cachedPreOneTop = parseInt(rows[0].style.top, 10);
            setPaddingBottom(quickInputListNode, 5);
        } else {
            setPaddingBottom(quickInputListNode, 0);
            return;
        }

        zoom(quickInputListNode, "maxHeight", "cachedMaxHeight");
        zoom(monacoListRows, "height", "cachedHeight");
        zoom(monacoListRows, "top", "cachedTop");
        let moving = false;
        rows.forEach((row) => {
            moving = zoom(row, "top", "cachedTop") || moving;
            // [[Patch]]
            // Fix a bug that some rows are not moving, so
            // I force-set their top based on the previous one.
            if (moving && parseInt(row.style.top, 10) < cachedPreOneTop) {
                set(
                    row,
                    cachedPreOneTop +
                    Math.floor(parseInt(row.style.height, 10) * factor),
                    "top",
                    "cachedTop"
                );
            }
            cachedPreOneTop = parseInt(row.style.top, 10);
        });

        const scrollbar = quickInputListNode.querySelector(".scrollbar.vertical");
        if (scrollbar) {
            zoom(scrollbar, "height", "cachedHeight");
            const slider = scrollbar.querySelector(".slider");
            zoom(slider, "height", "cachedHeight");
            zoom(slider, "top", "cachedTop");
        }
    }

    const observer = new MutationObserver((mutationsList) => {
        for (let mutation of mutationsList) {
            if (
                !menuExist &&
                mutation.type === "childList" &&
                mutation.addedNodes.length > 0
            ) {
                quickInputListNode = document.getElementById("quickInput_list");
                if (quickInputListNode) {
                    menuExist = true;
                    resize();
                    const maxHeightObserver = new MutationObserver(
                        () => resize()
                    );
                    maxHeightObserver.observe(quickInputListNode, {
                        attributes: true,
                        childList: true,
                        subtree: true,
                        attributeFilter: ["style"],
                    });
                }
            }
        }
    })

    const execute = () => {
        observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    }
    execute()
}

export default monacoEditorStyle;
