import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {SideBar} from "../../src/components/SideBar.jsx";

describe("SideBar", () => {
    test.each([500, 50])('dispatches the selected submenu action at height %s, including overflow', async height => {
        const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {configurable: true, get: () => height});
        try {
            const click = jest.fn();
            render(<SideBar position="right" click={click} menuItems={[
                {id: 'tools', name: 'Tools', icon: 'cog', submenu_list: [{id: 'copy', name: 'Copy snippet', message_type: 'copyItem'}]},
                {id: 'other', name: 'Other', icon: 'star'},
            ]}/>);
            if (height === 50) {
                fireEvent.click(await screen.findByRole('button', {name: 'more'}));
                fireEvent.mouseEnter(await screen.findByText('Tools'));
            } else fireEvent.click(await screen.findByRole('button', {name: 'Tools'}));
            fireEvent.click(await screen.findByText('Copy snippet'));
            expect(click).toHaveBeenCalledWith('tools', 'copy');
        } finally {
            if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original);
            else delete HTMLElement.prototype.clientHeight;
        }
    });
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
