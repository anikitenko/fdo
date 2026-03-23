import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import MarkdownRenderer from "../../../src/components/ai-chat/MarkdownRenderer.jsx";

describe("MarkdownRenderer status rendering", () => {
    test("autolinks plain URLs", () => {
        const { container } = render(
            <MarkdownRenderer role="assistant" text={"Autolink-like text: https://example.com"} />
        );

        const link = container.querySelector('a[href="https://example.com"]');
        expect(link).toBeTruthy();
        expect(link.textContent).toBe("https://example.com");
    });

    test("does not corrupt existing markdown links whose label is already a URL", () => {
        const { container } = render(
            <MarkdownRenderer
                role="assistant"
                text={"[https://example.com/reference](https://example.com/reference)"}
            />
        );

        const link = container.querySelector('a[href="https://example.com/reference"]');
        expect(link).toBeTruthy();
        expect(link.textContent).toBe("https://example.com/reference");
    });

    test("resolves reference-style links", () => {
        const markdown = [
            "This is a [reference link][docs].",
            "",
            "[docs]: https://www.markdownguide.org/",
        ].join("\n");

        const { container } = render(
            <MarkdownRenderer role="assistant" text={markdown} />
        );

        const link = container.querySelector('a[href="https://www.markdownguide.org/"]');
        expect(link).toBeTruthy();
        expect(link.textContent).toBe("reference link");
        expect(container.textContent).not.toContain("[docs]:");
    });

    test("resolves collapsed and shortcut reference links", () => {
        const markdown = [
            "This is a [collapsed reference][].",
            "This is a [shortcut reference].",
            "",
            "[collapsed reference]: https://example.com/collapsed",
            "[shortcut reference]: https://example.com/shortcut",
        ].join("\n");

        const { container } = render(
            <MarkdownRenderer role="assistant" text={markdown} />
        );

        expect(container.querySelector('a[href="https://example.com/collapsed"]')).toBeTruthy();
        expect(container.querySelector('a[href="https://example.com/shortcut"]')).toBeTruthy();
    });

    test("renders table statuses as semantic pills", () => {
        const markdown = [
            "| Status |",
            "| --- |",
            "| ✅ Active |",
            "| ⚠️ Inactive |",
            "| ❌ Blocked |",
        ].join("\n");

        const { container } = render(
            <MarkdownRenderer role="assistant" text={markdown} />
        );

        expect(container.querySelector(".status-pill--active")).toBeTruthy();
        expect(container.querySelector(".status-pill--inactive")).toBeTruthy();
        expect(container.querySelector(".status-pill--blocked")).toBeTruthy();
    });

    test("renders task-list pending as one semantic pill with a status icon", () => {
        const markdown = [
            "- [x] Done",
            "- [ ] Pending",
            "- [x] Verified",
        ].join("\n");

        const { container } = render(
            <MarkdownRenderer role="assistant" text={markdown} />
        );

        const pendingPill = container.querySelector(".status-pill--pending");
        expect(pendingPill).toBeTruthy();
        expect(pendingPill.textContent).toContain("🕒");
        expect(pendingPill.textContent).toContain("Pending");
        expect(pendingPill.querySelector('input[type="checkbox"]')).toBeNull();
    });

    test("keeps code blocks free from status pill conversion", () => {
        const markdown = [
            "```text",
            "Pending",
            "Blocked",
            "```",
        ].join("\n");

        const { container } = render(
            <MarkdownRenderer role="assistant" text={markdown} />
        );

        expect(container.querySelector(".status-pill")).toBeNull();
        expect(screen.getByText(/Pending/)).toBeTruthy();
        expect(screen.getByText(/Blocked/)).toBeTruthy();
    });

    test("renders fenced code blocks with a language label", () => {
        const markdown = [
            "```go",
            'fmt.Println("nested fence test")',
            "```",
        ].join("\n");

        const { container } = render(
            <MarkdownRenderer role="assistant" text={markdown} />
        );

        expect(screen.getByText("go")).toBeTruthy();
        expect(screen.getByText(/fmt\.Println/)).toBeTruthy();
        expect(container.querySelector("pre")).toBeTruthy();
        expect(container.textContent).not.toContain("```");
        expect(container.textContent).not.toContain("**go**");
        expect(container.textContent).not.toContain("<code>");
    });

    test("adds heading ids and supports internal anchor links", () => {
        const markdown = [
            "## Ref Example",
            "",
            "[Jump](#ref-example)",
        ].join("\n");

        const { container } = render(
            <MarkdownRenderer role="assistant" text={markdown} />
        );

        const heading = container.querySelector('[data-anchor-slug="ref-example"]');
        const anchor = container.querySelector('a[href="#ref-example"]');
        expect(heading).toBeTruthy();
        expect(anchor).toBeTruthy();
    });

    test("opens external links through Electron instead of browser navigation", () => {
        const openExternal = jest.spyOn(window.electron.system, "openExternal").mockImplementation(() => {});
        const preventDefault = jest.fn();
        const stopPropagation = jest.fn();

        render(
            <MarkdownRenderer role="assistant" text={"[Docs](https://example.com/reference)"} />
        );

        const anchor = screen.getByText("Docs");
        fireEvent.click(anchor, { preventDefault, stopPropagation });

        expect(openExternal).toHaveBeenCalledWith("https://example.com/reference");
        openExternal.mockRestore();
    });

    test("normalizes anchor-like links without a hash to in-chat anchors", () => {
        const { container } = render(
            <MarkdownRenderer
                role="assistant"
                text={[
                    "## Ref Example",
                    "",
                    "[Jump](ref-example)",
                ].join("\n")}
            />
        );

        expect(container.querySelector('a[href="#ref-example"]')).toBeTruthy();
    });

    test("keeps duplicate heading anchors scoped to the clicked renderer instance", () => {
        const markdown = [
            "## Ref Example",
            "",
            "[Jump](#ref-example)",
        ].join("\n");

        const { container } = render(
            <>
                <MarkdownRenderer role="assistant" text={markdown} />
                <MarkdownRenderer role="assistant" text={markdown} />
            </>
        );

        const headings = Array.from(container.querySelectorAll('[data-anchor-slug="ref-example"]'));
        const anchors = Array.from(container.querySelectorAll('a[href="#ref-example"]'));
        headings[0].scrollIntoView = jest.fn();
        headings[1].scrollIntoView = jest.fn();

        fireEvent.click(anchors[1]);

        expect(headings[0].scrollIntoView).not.toHaveBeenCalled();
        expect(headings[1].scrollIntoView).toHaveBeenCalled();
    });

    test("resolves anchor links to matching headings in previous renderer instances", () => {
        const headingMarkdown = [
            "## Shared Anchor",
            "",
            "Earlier section",
        ].join("\n");
        const linkMarkdown = "[Jump back](#shared-anchor)";

        const { container } = render(
            <>
                <MarkdownRenderer role="assistant" text={headingMarkdown} />
                <MarkdownRenderer role="assistant" text={linkMarkdown} />
            </>
        );

        const heading = container.querySelector('[data-anchor-slug="shared-anchor"]');
        const anchor = screen.getByText("Jump back");
        heading.scrollIntoView = jest.fn();

        fireEvent.click(anchor);

        expect(heading.scrollIntoView).toHaveBeenCalled();
    });

    test("unwraps markdown-literal href values into usable external links", () => {
        const { container } = render(
            <MarkdownRenderer
                role="assistant"
                text={"[ref-example]([https://example.com/reference](https://example.com/reference))"}
            />
        );

        expect(container.querySelector('a[href="https://example.com/reference"]')).toBeTruthy();
    });

    test("keeps bare ref-like text as plain text", () => {
        const { container } = render(
            <MarkdownRenderer role="assistant" text={"Reference-style looking text: ref-example"} />
        );

        expect(container.querySelector("a")).toBeNull();
        expect(screen.getByText(/ref-example/)).toBeTruthy();
    });
});
