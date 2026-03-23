import { createEditorWindowConfirmState } from "../../src/ipc/system_confirm_state.js";

describe("editor window confirm state", () => {
    test("starts with both one-shot approval flags disabled", () => {
        expect(createEditorWindowConfirmState()).toEqual({
            closeApprovedOnce: false,
            reloadApprovedOnce: false,
        });
    });

    test("supports independent one-shot close and reload approvals", () => {
        const state = createEditorWindowConfirmState();

        state.closeApprovedOnce = true;
        expect(state.closeApprovedOnce).toBe(true);
        expect(state.reloadApprovedOnce).toBe(false);

        state.reloadApprovedOnce = true;
        expect(state.closeApprovedOnce).toBe(true);
        expect(state.reloadApprovedOnce).toBe(true);
    });
});
