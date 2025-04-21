import React from "react";

export const CertificateValidComponent = ({cert}) => {
    return (
        <div style={{
            color: (() => {
                const daysLeft = (new Date(cert.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                if (daysLeft <= 0) return "#DB3737";      // red
                if (daysLeft <= 90) return "#F29D49";     // orange
                return "#0F9960";                         // green
            })(),
            fontWeight: 500
        }}>
            {(() => {
                const daysLeft = (new Date(cert.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                if (daysLeft <= 0) return "Expired";
                if (daysLeft <= 90) return `Expires in ${Math.floor(daysLeft)} days`;
                return `Valid — ${Math.floor(daysLeft)} days left`;
            })()}
        </div>
    )
}