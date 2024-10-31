//Start the library with the application ID set by the wordpress plugin
if(typeof pocket_native_ads.init === 'function') {
  if(!window.pm_native_vars || !window.pm_native_vars.application_id) {
    console.error('[Pocket Media Native Ads] - No applicationId set. Use the options page of this plugin to set an application id');
  }
  
  pocket_native_ads.init({applicationId: window.pm_native_vars.application_id});
}
