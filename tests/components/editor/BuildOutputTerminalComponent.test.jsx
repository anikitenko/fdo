import React from "react";
import {render, screen} from "@testing-library/react";
import BuildOutputTerminalComponent from "../../../src/components/editor/BuildOutputTerminalComponent.js";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";

jest.mock("../../../src/components/editor/AiCodingAgentPanel.jsx", () => function MockAiCodingAgentPanel(props) {
    const React = require("react");
    React.useEffect(() => {
        props.onActivityChange?.({
            isLoading: true,
            hasResponse: false,
            error: "",
            latestStatus: "Generating the implementation response.",
        });
    }, []);
    return <div>AI Coding Agent Panel</div>;
});

describe("BuildOutputTerminalComponent", () => {
    beforeEach(() => {
        virtualFS.notifications.reset();
        virtualFS.build.history = [
            {
                kind: "build",
                error: true,
                message: "Build failed: syntax error",
                ts: Date.UTC(2024, 2, 9, 16, 0, 0),
            },
            {
                kind: "test",
                error: true,
                message: "Assertion failed in /index.test.ts",
                ts: Date.UTC(2024, 2, 9, 16, 1, 0),
            },
        ];
        virtualFS.build.message = {kind: "build", error: false, message: "", ts: 0};
        virtualFS.build.inProgress = false;
        virtualFS.tabs.listMarkers = jest.fn(() => []);
    });

    test("renders separate Build and Tests tabs with timestamped entries", () => {
        const setSelectedTabId = jest.fn();
        const {rerender} = render(
            <BuildOutputTerminalComponent
                selectedTabId="output"
                setSelectedTabId={setSelectedTabId}
                codeEditor={null}
            />
        );

        expect(screen.getByRole("tab", {name: /Build/i})).toBeTruthy();
        expect(screen.getByRole("tab", {name: /Tests/i})).toBeTruthy();
        expect(screen.getByText(/AI Coding Agent Running/i)).toBeTruthy();
        expect(screen.getByText(/Generating the implementation response./i)).toBeTruthy();
        expect(screen.getByText(/Build failed: syntax error/i)).toBeTruthy();
        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeTruthy();

        rerender(
            <BuildOutputTerminalComponent
                selectedTabId="tests"
                setSelectedTabId={setSelectedTabId}
                codeEditor={null}
            />
        );

        expect(screen.getByText(/Assertion failed in \/index\.test\.ts/i)).toBeTruthy();
        expect(screen.getAllByText(/\d{2}:\d{2}:\d{2}/).length).toBeGreaterThan(0);
    });
});
