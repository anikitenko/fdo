import { BLANK_TEMPLATE_MAIN, BLANK_TEMPLATE_RENDER } from "../../src/components/editor/utils/virtualTemplates";

describe("virtual templates", () => {
  test("blank template main uses declarative renderOnLoad action bindings", () => {
    const content = BLANK_TEMPLATE_MAIN("Template Test");

    expect(content).toContain("defineRenderOnLoadActions");
    expect(content).toContain("window.createBackendReq(\"UI_MESSAGE\"");
    expect(content).toContain("strict: true");
    expect(content).toContain("selector: \"[data-role=\\\"refresh-status\\\"]\"");
  });

  test("blank template render includes action target elements", () => {
    const content = BLANK_TEMPLATE_RENDER("Template Test");

    expect(content).toContain("DOMButton");
    expect(content).toContain("\"data-role\": \"refresh-status\"");
    expect(content).toContain("\"data-role\": \"status\"");
  });
});
