import {Button, Card, Checkbox, Dialog, DialogBody} from "@blueprintjs/core";
import React from "react";
import {signingCertificateValue} from "../../../utils/system/certificateDisplay";
import CertificateDetails from "../../settings/panels/CertificateDetails";

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
            title="Select Signing Certificate"
        >
            <DialogBody>
                {rootCertificates.map((cert) => (
                    <Card key={signingCertificateValue(cert)} style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "5px" }}>
                            <CertificateDetails cert={cert}/>
                            <Button
                                style={{flexShrink: 0}}
                                intent="primary"
                                text="Use"
                                onClick={() => {
                                    setShow(false);
                                    if (rememberRef.current) {
                                        setRememberRootCert(signingCertificateValue(cert));
                                    }
                                    if (onRootSelectedCert) {
                                        onRootSelectedCert(signingCertificateValue(cert));
                                        setOnRootSelectedCert(null);
                                    }
                                }}
                            />
                        </div>
                    </Card>
                ))}
                <p className="bp6-text-muted" style={{marginTop: "12px"}}>
                    Signing uses a private key protected by FDO in your local profile. macOS may ask you to allow FDO to unlock it in Keychain. This does not give the plugin access to Keychain.
                </p>
                <div style={{ marginTop: "12px" }}>
                    <Checkbox
                        defaultChecked={rememberRef.current}
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
