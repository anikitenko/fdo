// Report transport failures without exposing request paths, credentials or tokens.
export function registryNetworkError(error, url) {
    const cause = error?.cause;
    const code = cause?.code || cause?.errors?.find(item => item?.code)?.code || error?.code;
    const host = new URL(url).hostname;
    let message;
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) message = `FDO could not resolve the registry host ${host}. Check DNS, VPN, or proxy settings and try again.`;
    else if (error?.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) message = `The connection to ${host} timed out. Check your network or proxy and try again.`;
    else if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)) message = `FDO could not verify the TLS certificate for ${host}. Check the system clock and certificate trust for your network or proxy.`;
    else if (['EACCES','EPERM'].includes(code)) message = `Network access to ${host} was denied. Check the app launch environment and firewall permissions.`;
    else if (['ECONNREFUSED','ECONNRESET','ENETUNREACH','EHOSTUNREACH'].includes(code)) message = `FDO could not connect to ${host}. Check your internet connection, VPN, or proxy and try again.`;
    else return error;
    return Object.assign(new Error(`${message}${code ? ` (${code})` : ''}`, {cause: error}), {code});
}
