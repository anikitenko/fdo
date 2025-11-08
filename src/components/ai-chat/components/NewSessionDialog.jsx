import React, { useState } from "react";
import { Dialog, InputGroup, Button, Classes } from "@blueprintjs/core";

export default function NewSessionDialog({ isOpen, setIsOpen, onSubmit }) {
    const [name, setName] = useState("");

    const handleSubmit = () => {
        if (name.trim()) {
            onSubmit(name.trim());
            setName("");
            setIsOpen(false);
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title="Create New Session"
            className="bp6-dark"
        >
            <div className={Classes.DIALOG_BODY}>
                <InputGroup
                    placeholder="Enter session name..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                />
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <Button onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button intent="primary" onClick={handleSubmit}>
                        Create
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}
