import React from "react";
import {fireEvent, render, waitFor} from "@testing-library/react";
import {SideBar} from "../../src/components/SideBar.jsx";

describe("SideBar", () => {
    test("marks the active plugin item and keeps click behavior", async () => {
        const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
        Object.defineProperty(HTMLElement.prototype, "clientHeight", {
            configurable: true,
            get() {
                return 500;
            },
        });
        try {
            const handleClick = jest.fn();
            const menuItems = [
                {id: "plugin-a", icon: "cog", name: "Plugin A"},
                {id: "plugin-b", icon: "cog", name: "Plugin B"},
            ];

            const {container} = render(
                <SideBar
                    position="left"
                    menuItems={menuItems}
                    click={handleClick}
                    activeItemId="plugin-a"
                />
            );

            await waitFor(() => {
                const activeNode = container.querySelector('[data-plugin-sidebar-item="plugin-a"]');
                expect(activeNode?.getAttribute("data-plugin-active")).toBe("true");
            });

            const pluginANode = container.querySelector('[data-plugin-sidebar-item="plugin-a"]');
            const pluginAButton = pluginANode?.querySelector("button");
            expect(pluginAButton).toBeTruthy();
            fireEvent.click(pluginAButton);
            expect(handleClick).not.toHaveBeenCalled();

            const pluginBNode = container.querySelector('[data-plugin-sidebar-item="plugin-b"]');
            const pluginBButton = pluginBNode?.querySelector("button");
            expect(pluginBButton).toBeTruthy();
            fireEvent.click(pluginBButton);
            expect(handleClick).toHaveBeenCalledWith("plugin-b");
        } finally {
            if (originalClientHeight) {
                Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
            } else {
                delete HTMLElement.prototype.clientHeight;
            }
        }
    });
});
