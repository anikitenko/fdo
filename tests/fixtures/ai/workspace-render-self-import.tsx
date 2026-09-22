import {
  FDOInterface,
  FDO_SDK,
  PluginMetadata,
} from "@anikitenko/fdo-sdk";
import { render } from "./render";
import css from "./styles.css";

export class WebToolsWorkbenchPlugin extends FDO_SDK implements FDOInterface {
  private readonly _metadata: PluginMetadata = {
    name: "Web Tools Workbench",
    version: "1.0.0",
    author: "Web Tools Workbench",
    description: "Local, deterministic webmaster utilities in one compact dashboard.",
    icon: "applications",
  };

  get metadata(): PluginMetadata {
    return this._metadata;
  }

  render(): string {
    const dom = new (globalThis as unknown as { DOM: new () => any }).DOM();

    const shellClass = dom.createClassFromStyle(css.shell);
    const dashboardClass = dom.createClassFromStyle(css.dashboard);
    const cardClass = dom.createClassFromStyle(css.card);
    const libraryClass = dom.createClassFromStyle(css.library);
    const workspaceClass = dom.createClassFromStyle(css.workspace);
    const resultClass = dom.createClassFromStyle(css.result);
    const dockClass = dom.createClassFromStyle(css.dock);

    void dashboardClass;
    void cardClass;
    void libraryClass;
    void workspaceClass;
    void resultClass;
    void dockClass;

    return `
      <div class="${shellClass}" data-role="tool-shell">
        ${render()}
      </div>
    `;
  }
}

export default new WebToolsWorkbenchPlugin();
