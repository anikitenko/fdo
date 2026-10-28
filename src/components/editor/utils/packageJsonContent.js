import appPackage from '../../../../package.json';
import sdkPackage from '@anikitenko/fdo-sdk/package.json';
import {HOST_PLUGIN_API_VERSION} from '../../../utils/sdk/pluginHostContract';
import {defaultPluginRequirements} from '../../../utils/sdk/pluginCompatibility';

export const packageJsonContent = (name) => JSON.stringify({
    name: name,
    main: "dist/index.cjs",
    source: "index.ts",
    fdo: {compatibility: defaultPluginRequirements({fdo: appPackage.version, sdk: sdkPackage.version, api: HOST_PLUGIN_API_VERSION})}
}, null, 2);
