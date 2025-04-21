import {Button, Card, Checkbox, Dialog, DialogBody} from "@blueprintjs/core";
import React from "react";

import PropTypes from "prop-types";

export const selectRootCert = async (setShow, rememberRootCert, rememberRef, setRememberRootCert, setOnRootSelectedCert) => {
    if (rememberRootCert) {
        return rememberRootCert;
    }

    return new Promise((resolve) => {
        setOnRootSelectedCert(() => label => {
            if (rememberRef.current) {
                setRememberRootCert(label);
            }
            resolve(label);
            setOnRootSelectedCert(null);
        });

        setOnRootSelectedCert.cancel = () => {
            resolve(null);
            setOnRootSelectedCert(null);
        };

        setShow(true);
    });
}

export const RootCertificateSelectionComponent = ({show, setShow, rootCertificates, rememberRef, setRememberRootCert, onRootSelectedCert, setOnRootSelectedCert}) => {
    return (
        <Dialog
            isOpen={show}
            onClose={() => {
                setShow(false);
                if (typeof setOnRootSelectedCert.cancel === "function") {
                    setOnRootSelectedCert.cancel();
                } else {
                    setOnRootSelectedCert(null);
                }
            }}
            title="Select Root Certificate"
        >
            <DialogBody>
                {rootCertificates.map((cert) => (
                    <Card key={cert.label} style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "5px" }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>{cert.label}</div>
                                <div style={{ fontSize: "12px", color: "#5C7080" }}>{cert.identity}</div>
                            </div>
                            <Button
                                intent="primary"
                                text="Use"
                                onClick={() => {
                                    setShow(false);
                                    if (rememberRef.current) {
                                        setRememberRootCert(cert.label);
                                    }
                                    if (onRootSelectedCert) {
                                        onRootSelectedCert(cert.label);
                                        setOnRootSelectedCert(null);
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
RootCertificateSelectionComponent.propTypes = {
    show: PropTypes.bool.isRequired,
    setShow: PropTypes.func.isRequired,
    rootCertificates: PropTypes.array,
    rememberRef: PropTypes.object.isRequired,
    setRememberRootCert: PropTypes.func.isRequired,
    onRootSelectedCert: PropTypes.func,
    setOnRootSelectedCert: PropTypes.func
}