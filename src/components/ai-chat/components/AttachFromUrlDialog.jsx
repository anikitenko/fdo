import React, { useState } from "react";
import { Dialog, InputGroup, Button, Classes } from "@blueprintjs/core";

export default function AttachFromUrlDialog({ isOpen, setIsOpen, onSubmit, t = (key) => key }) {
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
            title={t("attachDialogTitle")}
            className="bp6-dark"
        >
            <div className={Classes.DIALOG_BODY}>
                <InputGroup
                    placeholder={t("attachDialogPlaceholder")}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    autoFocus
                />
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <Button onClick={() => setIsOpen(false)}>{t("cancel")}</Button>
                    <Button intent="primary" onClick={handleSubmit}>
                        {t("attach")}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}
