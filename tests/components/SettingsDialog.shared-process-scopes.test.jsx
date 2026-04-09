import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";

jest.mock("../../src/components/settings/panels/GeneralPanel.jsx", () => ({
    GeneralPanel: () => <div>General Panel</div>,
}));

jest.mock("../../src/components/settings/panels/CertificatePanel.jsx", () => ({
    CertificatePanel: () => <div>Certificate Panel</div>,
}));

jest.mock("../../src/components/settings/panels/AIAssistantsPanel", () => ({
    __esModule: true,
    default: () => <div>AI Assistants Panel</div>,
}));

import {SettingsDialog} from "../../src/components/settings/SettingsDialog.jsx";

describe("SettingsDialog shared process scopes", () => {
    beforeEach(() => {
        localStorage.clear();
        window.electron = {
            plugin: {
                getSharedProcessScopes: jest.fn().mockResolvedValue({
                    success: true,
                    scopes: [
                        {
                            scope: "shared-monitoring",
                            title: "Shared Monitoring",
                            kind: "process",
                            category: "Shared User-Defined Scopes",
                            userDefined: true,
                            shared: true,
                            ownerType: "shared",
                            description: "Shared monitoring tools.",
                            allowedExecutables: ["/usr/local/bin/htop"],
                            allowedCwdRoots: ["/tmp"],
                            allowedEnvKeys: ["PATH"],
                            timeoutCeilingMs: 30000,
                            requireConfirmation: true,
                        },
                    ],
                }),
                getAll: jest.fn().mockResolvedValue({
                    success: true,
                    plugins: [
                        {
                            id: "plugin-a",
                            name: "Plugin A",
                            capabilities: ["system.process.scope.shared-monitoring"],
                        },
                    ],
                }),
                upsertSharedProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
                deleteSharedProcessScope: jest.fn().mockResolvedValue({success: true, scopes: []}),
            },
            settings: {
                certificates: {
                    getRoot: jest.fn().mockResolvedValue([]),
                },
                ai: {
                    getAssistants: jest.fn().mockResolvedValue([]),
                },
            },
            system: {
                isFdoInPath: jest.fn().mockResolvedValue({success: false}),
            },
        };
    });

    test("shows shared scopes under Settings", async () => {
        render(<SettingsDialog showSettingsDialog={true} setShowSettingsDialog={jest.fn()}/>);

        fireEvent.click(screen.getByRole("tab", {name: /Shared Scopes/i}));

        await waitFor(() => {
            expect(screen.getByText("Shared Process Scopes")).toBeInTheDocument();
        });

        expect(screen.getByText("Shared Monitoring")).toBeInTheDocument();
        expect(screen.getByText(/Granted to plugins: 1/)).toBeInTheDocument();
    });
});
