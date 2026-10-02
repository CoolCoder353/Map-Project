/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- a CommonJS config plugin, loaded by Expo at prebuild */
// Declares the app's network security configuration (Android `T-Network_Security_Configuration`).
//
// Normal builds: cleartext (http) traffic is refused for every domain, and only the system's
// certificate authorities are trusted. Builds made with ALLOW_HTTP=1 (test builds that talk to a
// local server, for example http://10.0.2.2:3000) permit cleartext instead; the build script
// refuses an http address without it. `usesCleartextTraffic` alone is ignored on Android 7+
// once a network security config exists, so both builds name the policy here.
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const CONFIG_NAME = 'network_security_config';

function networkSecurityConfigXml(allowCleartext) {
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="${allowCleartext ? 'true' : 'false'}">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;
}

function withNetworkSecurityConfig(config, { allowCleartext = false } = {}) {
  config = withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$['android:networkSecurityConfig'] = `@xml/${CONFIG_NAME}`;
    return c;
  });
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `${CONFIG_NAME}.xml`),
        networkSecurityConfigXml(allowCleartext),
      );
      return c;
    },
  ]);
}

module.exports = withNetworkSecurityConfig;
module.exports.networkSecurityConfigXml = networkSecurityConfigXml;
