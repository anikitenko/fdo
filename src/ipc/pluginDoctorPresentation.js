import * as sdkModule from '@anikitenko/fdo-sdk';
import {createPluginDoctorPresentation} from '../utils/plugins/runtime/pluginDoctor';

// SDK normalization runs in Node, not in the sandboxed renderer. The raw
// diagnostics transport remains __sdk.getDiagnostics.
export function normalizePluginDoctorPresentation(diagnostics, options) {
    return createPluginDoctorPresentation(diagnostics, options, sdkModule);
}
