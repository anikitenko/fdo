import React from "react";

export const CertificateValidComponent = ({cert}) => {
    const lifecycle = {
        revoked: 'Revoked — signing blocked',
        blocked: 'Signing blocked',
        unavailable: 'Status unavailable — signing blocked',
        expired: 'Expired — signing blocked',
    }[cert.lifecycleStatus];
    return (
        <div style={{
            color: (() => {
                if (lifecycle) return cert.lifecycleStatus === 'unavailable' ? '#A66321' : '#DB3737';
                const daysLeft = (new Date(cert.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                if (!Number.isFinite(daysLeft)) return "#738091";
                if (daysLeft <= 0) return "#DB3737";      // red
                if (daysLeft <= 90) return "#F29D49";     // orange
                return "#0F9960";                         // green
            })(),
            fontWeight: 500
        }}>
            {(() => {
                if (lifecycle) return lifecycle;
                const daysLeft = (new Date(cert.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                if (!Number.isFinite(daysLeft)) return "Expiry unavailable";
                if (daysLeft <= 0) return "Expired";
                if (daysLeft <= 90) return `Expires in ${Math.floor(daysLeft)} days`;
                return `Valid — ${Math.floor(daysLeft)} days left`;
            })()}
        </div>
    )
}