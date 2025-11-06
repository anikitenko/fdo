import React, { useState } from "react";
import { Dialog, InputGroup, Button, Classes } from "@blueprintjs/core";

export default function AttachFromUrlDialog({ isOpen, setIsOpen, onSubmit }) {
    const [url, setUrl] = useState("");

    const handleSubmit = () => {
        if (url.trim()) {
            onSubmit(url.trim());
            setUrl("");
            setIsOpen(false);
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title="Attach from URL"
            className="bp6-dark"
        >
            <div className={Classes.DIALOG_BODY}>
                <InputGroup
                    placeholder="Enter URL..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    autoFocus
                />
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <Button onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button intent="primary" onClick={handleSubmit}>
                        Attach
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}
