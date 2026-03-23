import React, { useState } from "react";
import { Dialog, InputGroup, Button, Classes } from "@blueprintjs/core";

export default function NewSessionDialog({ isOpen, setIsOpen, onSubmit, t = (key) => key }) {
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
            title={t("createNewSession")}
            className="bp6-dark"
        >
            <div className={Classes.DIALOG_BODY}>
                <InputGroup
                    placeholder={t("enterSessionName")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                />
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <Button onClick={() => setIsOpen(false)}>{t("cancel")}</Button>
                    <Button intent="primary" onClick={handleSubmit}>
                        {t("create")}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}
