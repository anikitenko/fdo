import {Button, Card, Checkbox, Dialog, DialogBody} from "@blueprintjs/core";
import PropTypes from "prop-types";
import React from "react";

export const selectCodeEditor = async (setShow, rememberEditor, rememberRef, setRememberEditor, setOnEditorSelected) => {
    if (rememberEditor) {
        return rememberEditor;
    }

    return new Promise((resolve) => {
        setOnEditorSelected(() => label => {
            if (rememberRef.current) {
                setRememberEditor(label);
            }
            resolve(label);
            setOnEditorSelected(null);
        });

        setOnEditorSelected.cancel = () => {
            resolve(null);
            setOnEditorSelected(null);
        };

        setShow(true);
    });
}

export const CodeEditorSelectionComponent = ({show, setShow, rememberRef, setRememberEditor, onEditorSelected, setOnEditorSelected}) => {
    const codeEditors = [
        {name: "builtin", label: "Open in BuiltIn"},
        {name: "vscode", label: "Open in VsCode"},
        {name: "idea", label: "Open in IntelliJ IDEA"},
        {name: "webstorm", label: "Open in IntelliJ WebStorm"},
    ]
    return (
        <Dialog
            isOpen={show}
            onClose={() => {
                setShow(false);
                if (typeof setOnEditorSelected.cancel === "function") {
                    setOnEditorSelected.cancel();
                } else {
                    setOnEditorSelected(null);
                }
            }}
            title="Select Root Certificate"
        >
            <DialogBody>
                {codeEditors.map((editor) => (
                    <Card key={editor.label} style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "5px" }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>{editor.label}</div>
                            </div>
                            <Button
                                intent="primary"
                                text="Open"
                                endIcon={"share"}
                                onClick={() => {
                                    setShow(false);
                                    if (rememberRef.current) {
                                        setRememberEditor(editor.name);
                                    }
                                    if (onEditorSelected) {
                                        onEditorSelected(editor.name);
                                        setOnEditorSelected(null);
                                    }
                                }}
                            />
                        </div>
                    </Card>
                ))}
                <div style={{ marginTop: "12px" }}>
                    <Checkbox
                        defaultChecked={false}
                        onChange={(e) => {
                            rememberRef.current = e.currentTarget.checked;
                        }}
                        label="Remember this selection for this session"
                    />
                </div>
            </DialogBody>
        </Dialog>
    )
}
CodeEditorSelectionComponent.propTypes = {
    show: PropTypes.bool.isRequired,
    setShow: PropTypes.func.isRequired,
    rememberRef: PropTypes.object.isRequired,
    setRememberEditor: PropTypes.func.isRequired,
    onEditorSelected: PropTypes.func,
    setOnEditorSelected: PropTypes.func
}