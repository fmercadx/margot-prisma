// Extends app.json. The only dynamic part: the release APK built by
// .github/workflows/personal-daily-hub-android.yml sets PDH_RELEASE_OFFLINE=1,
// which removes the INTERNET permission. The app never uses the network, so
// a build without the permission can prove it: the operating system itself
// refuses any connection the app might try to make.
//
// Development builds keep it, because Metro (the dev server that serves the
// JavaScript while you work) is reached over the network.

module.exports = ({ config }) => {
  if (process.env.PDH_RELEASE_OFFLINE !== '1') return config;
  return {
    ...config,
    android: {
      ...config.android,
      blockedPermissions: [...(config.android.blockedPermissions ?? []), 'android.permission.INTERNET'],
    },
  };
};
